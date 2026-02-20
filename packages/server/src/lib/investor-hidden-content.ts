export type InvestorHiddenPayload =
  | { html: string }
  | { items: Array<{ title: string; url: string; description?: string }> };

/**
 * Starter hidden-content payload.
 *
 * Replace this with real content (or make it DB-driven) once you know what you
 * want to hide/unlock.
 */
export function getInvestorHiddenPayload(): InvestorHiddenPayload {
  return {
    html: `
<div style="padding: 1rem; border: 1px solid #ddd; border-radius: 10px;">
  <h2 style="margin: 0 0 0.5rem;">Unlocked Investor Content</h2>
  <p style="margin: 0 0 0.75rem;">
    This content is served by the API only after NDA + investor password unlock.
  </p>
  <ul style="margin: 0; padding-left: 1.25rem;">
    <li><a href="https://305opportunityfund.com/" target="_blank" rel="noopener">Example link (replace me)</a></li>
  </ul>
</div>
    `.trim(),
  };
}

