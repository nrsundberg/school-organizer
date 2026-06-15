// Shared long-form content styles for blog posts and guides. The blog and
// guide article pages render byte-identical prose styling, so the rules live
// here once and are imported by both routes.
export function ProseStyles() {
  const css = `
    .prose-pr { color: rgb(255 255 255 / 0.85); font-size: 1.0625rem; line-height: 1.75; }
    .prose-pr > * + * { margin-top: 1.25em; }
    .prose-pr h2 { color: #fff; font-size: 1.6rem; font-weight: 700; line-height: 1.25; margin-top: 2.25em; margin-bottom: 0.5em; letter-spacing: -0.01em; }
    .prose-pr h3 { color: #fff; font-size: 1.25rem; font-weight: 700; line-height: 1.3; margin-top: 1.75em; margin-bottom: 0.5em; }
    .prose-pr p { margin: 1em 0; }
    .prose-pr a { color: #E9D500; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    .prose-pr a:hover { color: #f5e047; }
    .prose-pr strong { color: #fff; font-weight: 600; }
    .prose-pr em { color: rgb(255 255 255 / 0.9); }
    .prose-pr ul, .prose-pr ol { padding-left: 1.5rem; margin: 1em 0; }
    .prose-pr ul { list-style: disc; }
    .prose-pr ol { list-style: decimal; }
    .prose-pr li { margin: 0.4em 0; }
    .prose-pr li::marker { color: rgb(233 213 0 / 0.6); }
    .prose-pr blockquote {
      margin: 1.75em 0;
      padding: 0.25em 0 0.25em 1.25em;
      border-left: 3px solid #E9D500;
      color: #fff;
      font-size: 1.2rem;
      font-style: italic;
      line-height: 1.5;
    }
    .prose-pr blockquote p { margin: 0; }
    .prose-pr code {
      background: rgb(255 255 255 / 0.08);
      border: 1px solid rgb(255 255 255 / 0.08);
      padding: 0.1em 0.35em;
      border-radius: 0.35rem;
      font-size: 0.92em;
      color: #fff;
    }
    .prose-pr pre {
      background: #0a0d0d;
      border: 1px solid rgb(255 255 255 / 0.08);
      padding: 1rem 1.25rem;
      border-radius: 0.75rem;
      overflow-x: auto;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .prose-pr pre code { background: transparent; border: 0; padding: 0; }
    .prose-pr hr { border: 0; border-top: 1px solid rgb(255 255 255 / 0.1); margin: 2.25em 0; }
    .prose-pr img { border-radius: 0.75rem; max-width: 100%; height: auto; }
    .prose-pr table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.95rem; }
    .prose-pr th, .prose-pr td {
      border-bottom: 1px solid rgb(255 255 255 / 0.1);
      padding: 0.6em 0.75em;
      text-align: left;
    }
    .prose-pr th { color: #fff; font-weight: 600; }
  `;
  // eslint-disable-next-line react/no-danger
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
