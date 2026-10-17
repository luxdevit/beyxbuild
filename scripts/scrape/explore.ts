// Script esplorativo: scarica un campione di pagine dalla wiki e riassume
// quali template (infobox) usano e con quali campi, per decidere cosa estrarre.
//
// Uso:
//   npm run scrape:explore                              (tutti i pezzi Beyblade X)
//   npm run scrape:explore -- --category "Ratchets"     (campione di una categoria)
//   npm run scrape:explore -- --search "Beyblade X"     (elenca solo le categorie)
//
// Di default non parte dalle categorie, che sulla wiki possono essere incomplete:
// prende tutte le pagine che usano {{Part Infobox}} e tiene quelle con
// Series "Beyblade X", poi le conta per Classification (Blade, Ratchet, Bit...).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { categoryMembers, embeddedIn, fetchWikitext, searchCategories } from './mediawiki.ts';
import { parseTemplates, toPlainText } from './wikitext.ts';

const RAW_DIR = join(import.meta.dirname, '../../data/raw');
const PAGES_DIR = join(RAW_DIR, 'pages');
const EXAMPLES_PER_FIELD = 3;
const PART_TEMPLATE = 'Part Infobox';
const EXAMPLE_TITLES = 5;

const { values: args } = parseArgs({
	options: {
		search: { type: 'string' },
		category: { type: 'string', multiple: true, default: [] },
		limit: { type: 'string', default: '10' },
		refresh: { type: 'boolean', default: false }
	}
});
const limit = Number(args.limit);

interface FieldStats {
	count: number;
	examples: string[];
}

interface TemplateStats {
	pages: number;
	fields: Record<string, FieldStats>;
}

async function main() {
	await mkdir(PAGES_DIR, { recursive: true });

	// 1. Con --search elenchiamo solo le categorie, per sceglierle a mano
	if (args.search) {
		console.log(`\nCategorie che corrispondono a "${args.search}":`);
		for (const c of await searchCategories(args.search)) {
			console.log(`  ${c.title} (${c.pages} pagine)`);
		}
		return;
	}

	// 2. Senza --category: tutti i pezzi Beyblade X partendo dal template
	if (args.category.length === 0) {
		await exploreParts();
		return;
	}

	// 3. Con --category: campione di pagine per categoria, con cache su disco
	const report: Record<string, Record<string, TemplateStats>> = {};

	for (const category of args.category) {
		const titles = await categoryMembers(category, limit);
		console.log(`\n${category}: ${titles.length} pagine nel campione`);

		const pages = await loadPages(titles);
		report[category] = summarize(pages);
		printSummary(report[category]);
	}

	const reportPath = join(RAW_DIR, 'explore-report.json');
	await writeFile(reportPath, JSON.stringify(report, null, '\t'));
	console.log(`\nReport completo in ${reportPath}`);
}

/** Tutte le pagine con {{Part Infobox}}, filtrate per Series e raggruppate per Classification. */
async function exploreParts() {
	const titles = await embeddedIn(`Template:${PART_TEMPLATE}`);
	console.log(`\nPagine che usano {{${PART_TEMPLATE}}}: ${titles.length}`);

	const pages = await loadPages(titles);
	const xPages = new Map<string, string>();
	const byClassification: Record<string, string[]> = {};
	const excludedSeries: Record<string, number> = {};
	const withoutInfobox: string[] = [];
	const missingData: string[] = [];

	for (const [title, wikitext] of pages) {
		// Il template può essere incluso dentro un altro: lo cerchiamo solo al primo livello
		const infobox = parseTemplates(wikitext).find((t) => t.name === PART_TEMPLATE);
		if (!infobox) {
			withoutInfobox.push(title);
			continue;
		}

		const series = toPlainText(infobox.params.Series ?? '');
		if (!/beyblade x/i.test(series)) {
			const key = series || '(Series vuota)';
			excludedSeries[key] = (excludedSeries[key] ?? 0) + 1;
			continue;
		}

		xPages.set(title, wikitext);
		const classification = toPlainText(infobox.params.Classification ?? '') || '(vuota)';
		(byClassification[classification] ??= []).push(title);
		if (!infobox.params.Weight?.trim() || !infobox.params.AttackStat?.trim()) {
			missingData.push(title);
		}
	}

	console.log('\nEscluse perché non Beyblade X:');
	for (const [series, count] of sortByCount(excludedSeries)) {
		console.log(`  ${String(count).padStart(4)}  ${series}`);
	}

	console.log(`\nPezzi Beyblade X: ${xPages.size}, per Classification:`);
	for (const [classification, list] of Object.entries(byClassification).sort(
		([, a], [, b]) => b.length - a.length
	)) {
		const examples = list.slice(0, EXAMPLE_TITLES).join(', ');
		console.log(
			`  ${String(list.length).padStart(4)}  ${classification.padEnd(16)} es. ${examples}`
		);
	}

	if (withoutInfobox.length > 0) {
		console.log(`\nSenza {{${PART_TEMPLATE}}} al primo livello (${withoutInfobox.length}):`);
		console.log(`  ${withoutInfobox.join(', ')}`);
	}
	if (missingData.length > 0) {
		console.log(`\nPezzi Beyblade X senza Weight o AttackStat (${missingData.length}):`);
		console.log(`  ${missingData.join(', ')}`);
	}

	const fields = summarize(xPages);
	console.log('\nCampi usati dai pezzi Beyblade X:');
	printSummary(fields);

	const reportPath = join(RAW_DIR, 'parts-report.json');
	const report = { byClassification, excludedSeries, withoutInfobox, missingData, fields };
	await writeFile(reportPath, JSON.stringify(report, null, '\t'));
	console.log(`\nReport completo, con tutti i titoli, in ${reportPath}`);
}

function sortByCount(counts: Record<string, number>): [string, number][] {
	return Object.entries(counts).sort(([, a], [, b]) => b - a);
}

/** Legge le pagine dalla cache in data/raw/pages, scaricando solo quelle mancanti. */
async function loadPages(titles: string[]): Promise<Map<string, string>> {
	const pages = new Map<string, string>();
	const missing: string[] = [];

	for (const title of titles) {
		const file = cachePath(title);
		if (!args.refresh && existsSync(file)) pages.set(title, await readFile(file, 'utf8'));
		else missing.push(title);
	}

	if (missing.length > 0) {
		console.log(`  scarico ${missing.length} pagine...`);
		const fetched = await fetchWikitext(missing);
		for (const [title, text] of fetched) {
			pages.set(title, text);
			await writeFile(cachePath(title), text);
		}
	}

	return pages;
}

function cachePath(title: string): string {
	return join(PAGES_DIR, `${title.replace(/[^\w.-]+/g, '_')}.wikitext`);
}

/** Per ogni template: in quante pagine compare e quali campi usa, con qualche esempio. */
function summarize(pages: Map<string, string>): Record<string, TemplateStats> {
	const stats: Record<string, TemplateStats> = {};

	for (const wikitext of pages.values()) {
		// Contiamo ogni template una volta per pagina
		const seen = new Set<string>();

		for (const template of parseTemplates(wikitext)) {
			const params = Object.entries(template.params);
			if (params.length === 0) continue; // es. {{Stub}}, senza campi utili

			const t = (stats[template.name] ??= { pages: 0, fields: {} });
			if (!seen.has(template.name)) {
				t.pages++;
				seen.add(template.name);
			}

			for (const [key, raw] of params) {
				const field = (t.fields[key] ??= { count: 0, examples: [] });
				field.count++;
				const value = toPlainText(raw);
				if (
					value &&
					field.examples.length < EXAMPLES_PER_FIELD &&
					!field.examples.includes(value)
				) {
					field.examples.push(value);
				}
			}
		}
	}

	return stats;
}

function printSummary(stats: Record<string, TemplateStats>) {
	const sorted = Object.entries(stats).sort(([, a], [, b]) => b.pages - a.pages);

	for (const [name, t] of sorted) {
		console.log(`  {{${name}}} in ${t.pages} pagine`);
		for (const [key, f] of Object.entries(t.fields)) {
			const examples = f.examples.map((e) => JSON.stringify(e.slice(0, 40))).join(', ');
			console.log(`    ${key.padEnd(20)} ${String(f.count).padStart(3)}x  ${examples}`);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
