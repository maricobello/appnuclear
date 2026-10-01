// Baixa do bucket público do ONS (dados abertos, CC-BY) as séries usadas na avaliação
// em dados reais: CMO semi-horário e CMO semanal (DECOMP). Destino: data/ons (fora do git).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset";
const DIR = process.env.ONS_DATA_DIR ?? "data/ons";
mkdirSync(DIR, { recursive: true });
const year = new Date().getUTCFullYear();
const files = [];
for (let y = year - 2; y <= year; y++) {
  files.push([`${BASE}/cmo_tm/CMO_SEMIHORARIO_${y}.csv`, `cmo_${y}.csv`]);
  files.push([`${BASE}/cmo_se/CMO_SEMANAL_${y}.parquet`, `cmo_se_${y}.parquet`]);
}
for (const [url, name] of files) {
  const dest = `${DIR}/${name}`;
  const current = name.includes(String(year));
  if (existsSync(dest) && !current) continue; // anos fechados não mudam
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log("ok", name);
}
