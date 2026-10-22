import { createApp } from "./app";
import { createMemoryStore } from "../store/memoryStore";
import { seedAnswerRules } from "../store/seed";

const port = Number(process.env.PORT ?? 3000);

const store = createMemoryStore();
await seedAnswerRules(store);

const app = createApp({ store });
app.listen(port, () => {
  console.log(`sfc-chatbot listening on http://localhost:${port}`);
});
