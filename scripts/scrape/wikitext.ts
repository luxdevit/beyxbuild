// Parser minimale per il wikitext di MediaWiki.
// Estrae i template di primo livello (es. {{Infobox Blade | weight = 35 g}})
// con i loro parametri, senza dipendenze esterne.

export interface WikiTemplate {
	name: string;
	/** Parametri con nome (`| chiave = valore`), valori grezzi in wikitext. */
	params: Record<string, string>;
	/** Parametri posizionali (`| valore`), nell'ordine in cui compaiono. */
	positional: string[];
}

/**
 * Trova tutti i template di primo livello nel testo.
 * I template annidati restano dentro il valore del parametro che li contiene.
 */
export function parseTemplates(wikitext: string): WikiTemplate[] {
	const templates: WikiTemplate[] = [];
	let i = 0;

	while (i < wikitext.length) {
		if (wikitext.startsWith('{{', i)) {
			const end = findClosing(wikitext, i);
			if (end === -1) break; // template non chiuso: ci fermiamo
			const inner = wikitext.slice(i + 2, end);
			// I `{{{parametro}}}` sono variabili dei template, non template
			if (!inner.startsWith('{')) templates.push(parseTemplateBody(inner));
			i = end + 2;
		} else {
			i++;
		}
	}

	return templates;
}

/** Indice dei `}}` che chiudono il `{{` in posizione `start`, oppure -1. */
function findClosing(text: string, start: number): number {
	let depth = 0;
	let i = start;

	while (i < text.length) {
		if (text.startsWith('{{', i)) {
			depth++;
			i += 2;
		} else if (text.startsWith('}}', i)) {
			depth--;
			if (depth === 0) return i;
			i += 2;
		} else {
			i++;
		}
	}

	return -1;
}

function parseTemplateBody(inner: string): WikiTemplate {
	const [rawName, ...parts] = splitTopLevel(inner, '|');
	const template: WikiTemplate = { name: normalizeName(rawName), params: {}, positional: [] };

	for (const part of parts) {
		const eq = indexOfTopLevel(part, '=');
		if (eq === -1) {
			template.positional.push(part.trim());
		} else {
			const key = part.slice(0, eq).trim();
			template.params[key] = part.slice(eq + 1).trim();
		}
	}

	return template;
}

/** `Template:Infobox_Blade` e `infobox blade` diventano entrambi `Infobox Blade`. */
function normalizeName(raw: string): string {
	const name = raw
		.trim()
		.replace(/^template:/i, '')
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ');
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Divide il testo su `separator` ignorando quelli dentro `{{ }}` e `[[ ]]`,
 * così `[[Pagina|testo]]` o un template annidato non spezzano i parametri.
 */
export function splitTopLevel(text: string, separator: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let i = 0;

	while (i < text.length) {
		const skip = nestedLength(text, i);
		if (skip > 0) {
			i += skip;
		} else if (text[i] === separator) {
			parts.push(text.slice(start, i));
			start = i + 1;
			i++;
		} else {
			i++;
		}
	}

	parts.push(text.slice(start));
	return parts;
}

function indexOfTopLevel(text: string, char: string): number {
	let i = 0;
	while (i < text.length) {
		const skip = nestedLength(text, i);
		if (skip > 0) i += skip;
		else if (text[i] === char) return i;
		else i++;
	}
	return -1;
}

/** Se in `i` inizia un blocco `{{...}}` o `[[...]]`, ne restituisce la lunghezza, altrimenti 0. */
function nestedLength(text: string, i: number): number {
	for (const [open, close] of [
		['{{', '}}'],
		['[[', ']]']
	]) {
		if (!text.startsWith(open, i)) continue;
		let depth = 0;
		let j = i;
		while (j < text.length) {
			if (text.startsWith(open, j)) {
				depth++;
				j += 2;
			} else if (text.startsWith(close, j)) {
				depth--;
				j += 2;
				if (depth === 0) return j - i;
			} else {
				j++;
			}
		}
		return text.length - i; // blocco non chiuso: consuma il resto
	}
	return 0;
}

/**
 * Converte un valore wikitext in testo leggibile:
 * `[[Pagina|testo]]` → `testo`, rimuove `<ref>`, commenti e tag HTML.
 * I template annidati restano invariati: li gestiremo caso per caso.
 */
export function toPlainText(value: string): string {
	return value
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<ref[^>]*\/>/gi, '')
		.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
		.replace(/'{2,}/g, '')
		.trim();
}
