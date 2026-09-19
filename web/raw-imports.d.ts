// Vite's `?raw` import (the file's text as a string), used by the gin ui/ tests to build their page
// fake from web/games/gin-rummy/index.html itself (docs/MIGRATION.md step 12). tsconfig.web.json
// sets `types: []`, so this is the one declaration in place of `vite/client`.
declare module '*?raw' {
  const text: string;
  export default text;
}
