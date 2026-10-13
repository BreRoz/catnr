// Google Analytics 4. The Measurement ID is public (it ships in every page's HTML).
export const GA_MEASUREMENT_ID = "G-XS253DDTXH";

// Only the real production addresses report; staging, previews and local dev stay out of the data.
const GA_HOSTS = ["catnr.com", "catnr.bre999.workers.dev"];

// Inline in <head>: loads gtag.js only on a production host. Pageviews fire on load; history changes are
// picked up by GA4 Enhanced Measurement ("Page changes based on browser history events").
export const GA_BOOTSTRAP = `(function(){
  if (${JSON.stringify(GA_HOSTS)}.indexOf(location.hostname) === -1) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', '${GA_MEASUREMENT_ID}');
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}';
  document.head.appendChild(s);
})();`;

// Never pass names, notes, or anything Ari said or typed as a parameter.
export function trackEvent(name: string, params: Record<string, string | number | boolean> = {}) {
  try {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    gtag?.("event", name, params);
  } catch {
    // Analytics must never break the app.
  }
}
