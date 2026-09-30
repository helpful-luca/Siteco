'use client';

// Replaces the root layout, so no providers (and no i18n) are available here.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="de">
      <body style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <main role="alert" style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
          <div style={{ textAlign: 'center' }}>
            <p>Da ist etwas schiefgelaufen. / Something went wrong.</p>
            <button type="button" onClick={reset}>
              Erneut versuchen / Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
