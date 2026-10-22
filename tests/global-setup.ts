import { buildWidget } from "../scripts/build-widget.ts";

export default async function setup(): Promise<void> {
  await buildWidget();
}
