import { createApp } from './app.js';
import { openDb } from './db.js';

const port = Number(process.env.PORT || 3000);
const db = openDb();
const app = createApp({ db });

app.listen(port, () => {
  console.log(`Online store running at http://localhost:${port}`);
});