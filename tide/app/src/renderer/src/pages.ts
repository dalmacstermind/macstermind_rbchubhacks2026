// The screens the app can show. There are no URLs: App.tsx keeps the current one in its `page`
// variable, and the Tools column and step tabs change it with `go(page)`.
export type Page =
  | "upload"
  | "processing"
  | "report"
  | "review"
  | "label"
  | "surveys"
  | "qc"
  | "trends"
  | "species"
  | "settings";
