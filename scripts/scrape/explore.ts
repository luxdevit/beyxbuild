// Script esplorativo: scarica un campione di pagine dalla wiki e riassume
// quali template (infobox) usano e con quali campi, per decidere cosa estrarre.
//
// Uso:
//   npm run scrape:explore
//   npm run scrape:explore -- --search "Beyblade X" --limit 10
//   npm run scrape:explore -- --category "Beyblade X Blades" --category "Ratchets"
//
// Senza --category, usa le categorie trovate con --search che contengono
// Blade, Ratchet o Bit nel nome.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { categoryMembers, fetchWikitext, searchCategories } from './mediawiki.ts';
import { parseTemplates, toPlainText } from './wikitext.ts';

const RAW_DIR = join(import.meta.dirname, '../../data/raw');
const PAGES_DIR = join(RAW_DIR, 'pages');
const EXAMPLES_PER_FIELD = 3;

const { values: args } = parseArgs({
	options: {
		search: { type: 'string', default: 'Beyblade X' },
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

	// 1. Categorie
	console.log(`\nCategorie che corrispondono a "${args.search}":`);
	const found = await searchCategories(args.search);
	for (const c of found) console.log(`  ${c.title} (${c.pages} pagine)`);

	const categories =
		args.category.length > 0
			? args.category
			: found.filter((c) => /blade|ratchet|bit/i.test(c.title)).map((c) => c.title);

	if (categories.length === 0) {
		console.log('\nNessuna categoria da esplorare: passale con --category "Nome".');
		return;
	}

	// 2. Campione di pagine per categoria, con cache su disco
	const report: Record<string, Record<string, TemplateStats>> = {};

	for (const category of categories) {
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
