// A scripted stand-in for the AI provider, used only by the browser tests (wrangler env "e2e").
// The app sends its normal OpenRouter chat-completions request; this answers with a fixed, schema-shaped plan
// chosen by the words Ari "says". Anything it does not recognise comes back as "clarify", like a cautious model.
import http from 'node:http';

const blank = () => ({ intent: 'record', message: '', clarification: null, confidence: 0.9, cats: [], events: [], people: [], transactions: [], query: { kind: 'none', catId: null, status: null, year: null, search: null }, socialDraft: null });
const cat = (o) => ({ ref: 'c1', existingId: null, name: null, sex: null, ageClass: null, appearance: null, distinguishingCharacteristics: null, healthObservations: null, reproductiveSignificance: null, origin: null, currentStatus: null, currentLocation: null, microchipNumber: null, ...o });
const event = (o) => ({ catRef: null, eventType: 'observation', occurredAt: null, location: null, personName: null, notes: null, ...o });
const txn = (o) => ({ transactionType: 'cash', direction: 'inflow', date: null, amount: null, currency: 'USD', personName: null, category: null, description: '', item: null, quantity: null, unit: null, estimatedValue: null, relatedCatRef: null, ...o });

export function plan(text, stored) {
  const p = blank(), t = text.toLowerCase();
  if (t.includes('new kitten at maple')) {
    p.message = 'Saved a new cat.';
    p.cats = [cat({ ref: 'n1', name: 'Pepper', sex: 'female', ageClass: 'kitten', appearance: 'gray tabby', origin: 'Maple Street' })];
    p.events = [event({ catRef: 'n1', eventType: 'first_seen', notes: text })];
  } else if (t.includes('pepper got her rabies')) {
    const c = stored.cats.find((x) => x.name === 'Pepper');
    p.message = 'Recorded the vaccination.';
    p.cats = [cat({ ref: c.id, existingId: c.id })];
    p.events = [event({ catRef: c.id, eventType: 'vaccination: rabies', notes: text })];
  } else if (t.includes('the one with the white paws')) {
    const c = stored.cats.find((x) => /white paws/.test(`${x.appearance} ${x.distinguishing_characteristics}`.toLowerCase()));
    p.cats = [cat({ ref: c.id, existingId: c.id })];
    p.events = [event({ catRef: c.id, eventType: 'neuter', notes: text })];
    p.message = 'Recorded.';
  } else if (t.includes('got neutered')) {
    // two stored cats match "the gray one": the cautious answer is to ask which
    const grays = stored.cats.filter((x) => /gray|grey/.test(`${x.appearance} ${x.name}`.toLowerCase()));
    if (grays.length > 1) { p.intent = 'clarify'; p.clarification = 'Which gray cat got neutered?'; p.message = p.clarification; }
    else { const c = grays[0]; p.cats = [cat({ ref: c.id, existingId: c.id })]; p.events = [event({ catRef: c.id, eventType: 'neuter', notes: text })]; p.message = 'Recorded.'; }
  } else if (t.includes('donated $')) {
    const amount = Number(t.match(/\$(\d+)/)[1]);
    p.message = 'Saved the donation.';
    p.people = [{ ref: 'p1', existingId: null, name: 'Sarah Yunker', type: 'donor', generalLocation: null, contact: null }];
    p.transactions = [txn({ transactionType: 'cash_donation', direction: 'inflow', amount, personName: 'Sarah Yunker', category: 'donation', description: `Sarah Yunker donated $${amount}` })];
  } else if (t.includes('i spent $')) {
    const amount = Number(t.match(/\$(\d+)/)[1]);
    p.message = 'Saved the expense.';
    p.transactions = [txn({ transactionType: 'supply_purchase', direction: 'outflow', amount, category: 'supplies', description: `Spent $${amount} on stickers` })];
  } else {
    p.intent = 'clarify'; p.clarification = 'I did not understand that. Can you say it another way?'; p.message = p.clarification;
  }
  return p;
}

export function startFakeAi(port) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        const user = body.messages.find((m) => m.role === 'user').content.find((c) => c.type === 'text').text;
        const input = user.match(/User input: ([\s\S]*?)\nStored records: /)[1];
        const stored = JSON.parse(user.slice(user.indexOf('Stored records: ') + 'Stored records: '.length));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan(input, stored)) } }] }));
      } catch (e) { res.statusCode = 500; res.end(String(e)); }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === new URL(import.meta.url).pathname) { await startFakeAi(Number(process.env.PORT || 8788)); console.log('fake AI listening'); }
