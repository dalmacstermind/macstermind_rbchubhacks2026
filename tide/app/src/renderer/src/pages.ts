// The screens the app can show. There are no URLs: App.tsx keeps the current one in its `page`
// variable, and the top bar and step tabs change it with `go(page)`.
export type Page = "upload" | "processing" | "report" | "review" | "label" | "qc" | "trends" | "species" | "settings";
