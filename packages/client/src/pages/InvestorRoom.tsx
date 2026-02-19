import { useEffect } from 'react';

export default function InvestorRoom() {
  useEffect(() => {
    // Serve the static investor HTML as the actual page.
    // Avoids "embedded" rendering inside a React wrapper.
    window.location.replace('/investor-site/investors.html');
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      Redirecting...
    </div>
  );
}

