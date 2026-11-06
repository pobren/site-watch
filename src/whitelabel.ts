// Names and links that show outside the app itself: the user agent websites see in their logs, the API docs link
// and what the AI connector calls itself. An install selling under its own brand sets these as plain variables on
// the Worker (CHECK_AGENT, DOCS_URL, HOME_URL, APP_NAME); otherwise they're Site Watch's.

export interface WhiteLabelEnv { CHECK_AGENT?: string; DOCS_URL?: string; HOME_URL?: string; APP_NAME?: string }

export const WL = {
	agent: "Mozilla/5.0 (compatible; SiteWatch/1.0; +https://paulobrien.dev/watch/)",
	docs: "https://paulobrien.dev/watch/api/",
	home: "https://paulobrien.dev/watch/",
	name: "Site Watch",
};

/** Called at the start of every request, cron run and queue batch. */
export function configure(env: WhiteLabelEnv): void {
	if (env.CHECK_AGENT) WL.agent = env.CHECK_AGENT;
	if (env.DOCS_URL) WL.docs = env.DOCS_URL;
	if (env.HOME_URL) WL.home = env.HOME_URL;
	if (env.APP_NAME) WL.name = env.APP_NAME;
}
