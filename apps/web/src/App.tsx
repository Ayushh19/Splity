import { useEffect, useState } from 'react';
import { computeSplit, formatAmount, memberOrder } from '@splity/shared';

// Placeholder screen: proves the web app, the shared money package and the API are wired together.
const order = memberOrder([
  { id: 'you', sortKey: 1 },
  { id: 'priya', sortKey: 2 },
  { id: 'arjun', sortKey: 3 },
]);
const example = computeSplit(100000, { method: 'equal', participants: ['you', 'priya', 'arjun'] }, order);

export function App() {
  const [api, setApi] = useState('checking…');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((body: { status: string }) => setApi(body.status))
      .catch(() => setApi('unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <h1>Splity</h1>
      <p>₹1,000 split three ways:</p>
      <ul>
        {example.map((o) => (
          <li key={o.memberId}>
            {o.memberId}: {formatAmount(o.owedMinor, 'INR')}
          </li>
        ))}
      </ul>
      <p>API: {api}</p>
    </main>
  );
}
