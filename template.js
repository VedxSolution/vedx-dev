/**
 * backend/src/ssr/template.js
 *
 * Injects the SSR render output into the index.html shell.
 *
 * Placeholders added to frontend/index.html:
 *   <!--ssr-styles-->   → Emotion/MUI critical CSS head tags (in <head>)
 *   <!--ssr-outlet-->   → ReactDOMServer.renderToString() HTML (in #root)
 *
 * Helmet tags (title, meta, link, script) are injected before </head>.
 */

/**
 * @param {string} template   Raw index.html content
 * @param {object} payload
 * @param {string} payload.html        ReactDOMServer.renderToString() output
 * @param {string} payload.styles      Emotion critical CSS head tags
 * @param {object} payload.helmet      react-helmet-async context object
 * @param {string} payload.noIndexTag  Optional noindex meta tag (dev only)
 * @returns {string}  Complete HTML document ready to send to the browser
 */
export const injectIntoTemplate = (template, { html = '', styles = '', helmet, noIndexTag = '' } = {}) => {
  let result = template;

  // 1. Emotion/MUI styles → <head>
  result = result.replace('<!--ssr-styles-->', styles);

  // 2. noindex tag → first thing in <head>, only injected on dev build
  //    (VITE_NOINDEX=true in .env.development, empty string on production)
  if (noIndexTag) {
    result = result.replace('</head>', `  ${noIndexTag}\n</head>`);
  }

  // 3. Helmet tags → just before </head>
  //    Each page sets its own <title>, <meta name="description">, canonical, JSON-LD etc.
  if (helmet) {
    const helmetTags = [
      helmet.title?.toString()  ?? '',
      helmet.meta?.toString()   ?? '',
      helmet.link?.toString()   ?? '',
      helmet.script?.toString() ?? '',
    ]
      .filter(Boolean)
      .join('\n  ');

    if (helmetTags) {
      result = result.replace('</head>', `  ${helmetTags}\n</head>`);
    }
  }

  // 4. Rendered React HTML → #root inner content
  result = result.replace('<!--ssr-outlet-->', html);

  return result;
};
