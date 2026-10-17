// Client minimale per l'API MediaWiki di Fandom (api.php).
// Una richiesta alla volta, con pausa tra le richieste, per non pesare sul sito.

const API_URL = 'https://beyblade.fandom.com/api.php';
const USER_AGENT = 'BeyXBuildScraper/0.1 (https://github.com/luxdevit/beyxbuild)';
const DELAY_MS = 1000;

let lastRequest = 0;

type Params = Record<string, string | number>;

// L'API risponde con JSON di forma diversa a seconda dell'azione:
// lo tipizziamo solo dove lo leggiamo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = any;

export async function apiGet(params: Params): Promise<ApiResponse> {
	const wait = lastRequest + DELAY_MS - Date.now();
	if (wait > 0) await sleep(wait);
	lastRequest = Date.now();

	const url = new URL(API_URL);
	const query: Params = { format: 'json', formatversion: 2, maxlag: 5, ...params };
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);

	const data = await res.json();
	if (data.error?.code === 'maxlag') {
		// Il server è sotto carico: aspettiamo e riproviamo
		await sleep(5000);
		return apiGet(params);
	}
	if (data.error) throw new Error(`Errore API ${data.error.code}: ${data.error.info}`);
	return data;
}

/** Segue la paginazione (`continue`) dell'API e restituisce tutte le risposte. */
async function apiGetAll(params: Params, max = Infinity): Promise<ApiResponse[]> {
	const pages: ApiResponse[] = [];
	let cont: Params = {};

	do {
		const data = await apiGet({ ...params, ...cont });
		pages.push(data);
		cont = data.continue ?? {};
	} while (Object.keys(cont).length > 0 && pages.length < max);

	return pages;
}

export interface CategoryInfo {
	title: string;
	pages: number;
}

/** Cerca le categorie il cui nome contiene `query` (namespace 14 = Categoria). */
export async function searchCategories(query: string): Promise<CategoryInfo[]> {
	const data = await apiGet({
		action: 'query',
		generator: 'search',
		gsrsearch: query,
		gsrnamespace: 14,
		gsrlimit: 50,
		prop: 'categoryinfo'
	});

	return (data.query?.pages ?? []).map((p: ApiResponse) => ({
		title: p.title,
		pages: p.categoryinfo?.pages ?? 0
	}));
}

/** Titoli delle pagine (solo articoli, namespace 0) dentro una categoria. */
export async function categoryMembers(category: string, limit: number): Promise<string[]> {
	const title = category.startsWith('Category:') ? category : `Category:${category}`;
	const responses = await apiGetAll(
		{
			action: 'query',
			list: 'categorymembers',
			cmtitle: title,
			cmnamespace: 0,
			cmlimit: Math.min(limit, 500)
		},
		Math.ceil(limit / 500)
	);

	return responses
		.flatMap((r) => r.query.categorymembers.map((m: ApiResponse) => m.title as string))
		.slice(0, limit);
}

/** Wikitext delle pagine richieste, a blocchi di 50 titoli (limite dell'API). */
export async function fetchWikitext(titles: string[]): Promise<Map<string, string>> {
	const result = new Map<string, string>();

	for (let i = 0; i < titles.length; i += 50) {
		const data = await apiGet({
			action: 'query',
			prop: 'revisions',
			rvprop: 'content',
			rvslots: 'main',
			titles: titles.slice(i, i + 50).join('|')
		});

		for (const page of data.query.pages) {
			const content = page.revisions?.[0]?.slots?.main?.content;
			if (typeof content === 'string') result.set(page.title, content);
		}
	}

	return result;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
