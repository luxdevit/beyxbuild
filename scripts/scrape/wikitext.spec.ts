import { describe, it, expect } from 'vitest';
import { parseTemplates, splitTopLevel, toPlainText } from './wikitext.ts';

describe('parseTemplates', () => {
	it('estrae nome e parametri di un infobox', () => {
		const wikitext = `{{Infobox Blade
| name = DranSword
| weight = 35.0 g
| type = [[Attack Type|Attack]]
}}
'''DranSword''' is a Blade...`;

		expect(parseTemplates(wikitext)).toEqual([
			{
				name: 'Infobox Blade',
				params: { name: 'DranSword', weight: '35.0 g', type: '[[Attack Type|Attack]]' },
				positional: []
			}
		]);
	});

	it('lascia i template annidati dentro il valore', () => {
		const [template] = parseTemplates('{{Part | height = {{convert|60|mm}} | a=b}}');
		expect(template.params).toEqual({ height: '{{convert|60|mm}}', a: 'b' });
	});

	it('trova più template di primo livello e i parametri posizionali', () => {
		const templates = parseTemplates('{{Stub}} testo {{template:quote_box|ciao|autore=X}}');
		expect(templates.map((t) => t.name)).toEqual(['Stub', 'Quote box']);
		expect(templates[1].positional).toEqual(['ciao']);
		expect(templates[1].params).toEqual({ autore: 'X' });
	});

	it('ignora le variabili {{{...}}} e i template non chiusi', () => {
		expect(parseTemplates('{{{1}}}')).toEqual([]);
		expect(parseTemplates('{{Aperto | a = 1')).toEqual([]);
	});
});

describe('splitTopLevel', () => {
	it('non divide dentro link e template', () => {
		expect(splitTopLevel('a|[[b|c]]|{{d|e}}', '|')).toEqual(['a', '[[b|c]]', '{{d|e}}']);
	});
});

describe('toPlainText', () => {
	it('pulisce link, ref, commenti e grassetto', () => {
		expect(toPlainText("'''[[Attack Type|Attack]]'''<ref>fonte</ref> <!-- nota -->")).toBe(
			'Attack'
		);
		expect(toPlainText('[[DranSword]]<br/>35 g')).toBe('DranSword\n35 g');
	});
});
