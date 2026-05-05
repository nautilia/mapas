#!/usr/bin/env node

/**
 * extraer-mapbox-vector-tiles.mjs
 *
 * Scraper genérico para extraer datos de un tileset vectorial de Mapbox
 * y exportarlos a CSV.
 *
 * Caso típico:
 *   Una web muestra un mapa con Mapbox GL JS. Los datos no están en un JSON
 *   visible, sino codificados en tiles vectoriales .vector.pbf / .mvt.
 *
 * Este script:
 *   1. Pide el TileJSON del tileset.
 *   2. Lee bounds, tiles, maxzoom y vector_layers.
 *   3. Descarga todos los tiles que cubren el bounds.
 *   4. Decodifica los PBF/MVT.
 *   5. Extrae geometría + properties.
 *   6. Deduplica features.
 *   7. Exporta CSV.
 *
 * Instalación:
 *   npm init -y
 *   npm install @mapbox/vector-tile pbf
 *
 * Uso básico:
 *   node extraer-mapbox-vector-tiles.mjs \
 *     --tileset senderoazul.cmorcsai81b1r1nqidivznavn-999zb \
 *     --token pk.xxxxx \
 *     --out salida.csv
 *
 * Uso indicando una capa concreta:
 *   node extraer-mapbox-vector-tiles.mjs \
 *     --tileset senderoazul.cmorcsai81b1r1nqidivznavn-999zb \
 *     --token pk.xxxxx \
 *     --layer PLAYAS_BANDERA_AZUL_2026 \
 *     --zoom 10 \
 *     --out playas.csv
 *
 * Uso sacando solo algunos campos y renombrándolos:
 *   node extraer-mapbox-vector-tiles.mjs \
 *     --tileset senderoazul.cmorcsai81b1r1nqidivznavn-999zb \
 *     --token pk.xxxxx \
 *     --layer PLAYAS_BANDERA_AZUL_2026 \
 *     --fields nombre:title,municipio:MUNICIPIO,provincia:PROVINCIA,ccaa:ccaa \
 *     --out playas.csv
 *
 * Notas:
 *   - En GeoJSON/Mapbox las coordenadas suelen estar en orden lon, lat.
 *   - El CSV siempre incluye lon y lat.
 *   - Si la geometría no es Point, calcula un centroide simple aproximado.
 *   - Para datasets grandes, bajar el zoom puede acelerar el proceso, pero
 *     puede perder precisión o features según cómo esté generado el tileset.
 */

import fs from "node:fs";
import process from "node:process";
import { VectorTile } from "@mapbox/vector-tile";
import Protobuf from "pbf";

const DEFAULT_OUTPUT = "mapbox-vector-tiles.csv";
const DEFAULT_TILEJSON_TEMPLATE = "https://api.mapbox.com/v4/{tileset}.json?secure&access_token={token}";

function printHelp() {
  console.log(`
Scraper genérico de tiles vectoriales Mapbox → CSV

Uso:
  node extraer-mapbox-vector-tiles.mjs --tileset USUARIO.ID --token pk.xxxxx [opciones]

Opciones obligatorias:
  --tileset USUARIO.ID       ID del tileset de Mapbox. Ej: senderoazul.xxxxx
  --token pk.xxxxx           Token público de Mapbox encontrado en la web

Opciones comunes:
  --layer NOMBRE             Capa vectorial a extraer. Si no se indica, extrae todas
  --zoom NUMERO              Zoom a descargar. Si no se indica, usa maxzoom del TileJSON
  --out ARCHIVO.csv          Nombre del CSV de salida. Por defecto: ${DEFAULT_OUTPUT}
  --fields MAPA              Campos a exportar y renombrar
  --bbox O,S,E,N             Bounds manual: oeste,sur,este,norte
  --list-layers              Solo muestra las capas y campos disponibles del TileJSON
  --keep-empty               Mantiene filas aunque no haya lon/lat calculable
  --help                     Muestra esta ayuda

Formato de --fields:
  alias1:campoOriginal1,alias2:campoOriginal2

Ejemplo:
  --fields nombre:title,municipio:MUNICIPIO,provincia:PROVINCIA

Ejemplo real:
  node extraer-mapbox-vector-tiles.mjs \\
    --tileset senderoazul.cmorcsai81b1r1nqidivznavn-999zb \\
    --token pk.eyJ1Ijoic2VuZGVyb2F6dWwiLCJhIjoiNXkwUnUzdyJ9.-HQbQcudJ9rJJHWCGCZSog \\
    --layer PLAYAS_BANDERA_AZUL_2026 \\
    --fields nombre:title,municipio:MUNICIPIO,provincia:PROVINCIA,ccaa:ccaa,galardonado:galardonado,nueva:nueva,recupera:recupera \\
    --out playas-bandera-azul-2026.csv
`);
}

function parseArgs(argv) {
  const args = {
    tileset: null,
    token: null,
    layer: null,
    zoom: null,
    out: DEFAULT_OUTPUT,
    fields: null,
    bbox: null,
    listLayers: false,
    keepEmpty: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--tileset":
        args.tileset = argv[++i];
        break;
      case "--token":
        args.token = argv[++i];
        break;
      case "--layer":
        args.layer = argv[++i];
        break;
      case "--zoom":
        args.zoom = Number(argv[++i]);
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--fields":
        args.fields = parseFieldMap(argv[++i]);
        break;
      case "--bbox":
        args.bbox = parseBBox(argv[++i]);
        break;
      case "--list-layers":
        args.listLayers = true;
        break;
      case "--keep-empty":
        args.keepEmpty = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  return args;
}

function parseFieldMap(value) {
  if (!value) return null;

  const map = [];

  for (const part of value.split(",")) {
    const [alias, original] = part.split(":");

    if (!alias || !original) {
      throw new Error(
        `Formato incorrecto en --fields: ${part}. Usa alias:campoOriginal,alias2:campo2`
      );
    }

    map.push({ alias: alias.trim(), original: original.trim() });
  }

  return map;
}

function parseBBox(value) {
  const nums = value.split(",").map(Number);

  if (nums.length !== 4 || nums.some(Number.isNaN)) {
    throw new Error("Formato incorrecto en --bbox. Usa: oeste,sur,este,norte");
  }

  return nums;
}

function requireArgs(args) {
  if (args.help) return;

  if (!args.tileset) {
    throw new Error("Falta --tileset USUARIO.ID");
  }

  if (!args.token) {
    throw new Error("Falta --token pk.xxxxx");
  }

  if (args.zoom !== null && (!Number.isInteger(args.zoom) || args.zoom < 0 || args.zoom > 22)) {
    throw new Error("--zoom debe ser un entero entre 0 y 22");
  }
}

async function fetchJSON(url) {
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Error HTTP ${res.status} al pedir ${url}\n${text}`);
  }

  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url);

  // Muchos tiles dentro del rango pueden no existir o venir vacíos.
  // No lo tratamos como error fatal.
  if (!res.ok) return null;

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function buildTileJSONUrl(tileset, token) {
  return DEFAULT_TILEJSON_TEMPLATE
    .replace("{tileset}", encodeURIComponent(tileset))
    .replace("{token}", encodeURIComponent(token));
}

function printTileJSONSummary(tilejson) {
  console.log("\nResumen del TileJSON:");
  console.log(`  id:       ${tilejson.id || ""}`);
  console.log(`  name:     ${tilejson.name || ""}`);
  console.log(`  minzoom:  ${tilejson.minzoom}`);
  console.log(`  maxzoom:  ${tilejson.maxzoom}`);
  console.log(`  bounds:   ${JSON.stringify(tilejson.bounds)}`);

  console.log("\nCapas vectoriales disponibles:");

  for (const layer of tilejson.vector_layers || []) {
    console.log(`\n  - ${layer.id}`);
    const fields = layer.fields || {};
    const fieldNames = Object.keys(fields);

    if (!fieldNames.length) {
      console.log("    fields: sin campos declarados");
      continue;
    }

    console.log("    fields:");
    for (const name of fieldNames) {
      console.log(`      ${name}: ${fields[name]}`);
    }
  }
}

function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function lat2tile(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      Math.pow(2, z)
  );
}

function getTileRange(bounds, z) {
  const [west, south, east, north] = bounds;

  const xMin = lon2tile(west, z);
  const xMax = lon2tile(east, z);
  const yMin = lat2tile(north, z);
  const yMax = lat2tile(south, z);

  return { xMin, xMax, yMin, yMax };
}

function fillTileUrl(template, token, z, x, y) {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{access_token}", encodeURIComponent(token));
}

function extractRepresentativeLonLat(geometry) {
  if (!geometry || !geometry.coordinates) return [null, null];

  if (geometry.type === "Point") {
    return geometry.coordinates;
  }

  if (geometry.type === "MultiPoint") {
    return averageCoordinateList(geometry.coordinates);
  }

  // Para LineString, Polygon, MultiPolygon, etc. se calcula un centroide simple
  // como media de vértices. No es un centroide geodésico exacto, pero suele ser
  // suficiente para ubicar la feature en un CSV para visualización.
  const coords = [];

  function walk(value) {
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      coords.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    }
  }

  walk(geometry.coordinates);

  return averageCoordinateList(coords);
}

function averageCoordinateList(coords) {
  if (!coords.length) return [null, null];

  const lon = coords.reduce((acc, p) => acc + p[0], 0) / coords.length;
  const lat = coords.reduce((acc, p) => acc + p[1], 0) / coords.length;

  return [lon, lat];
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const s = String(value);

  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }

  return s;
}

function inferColumns(rows, fieldMap) {
  if (fieldMap && fieldMap.length) {
    return [
      "layer",
      ...fieldMap.map(item => item.alias),
      "lon",
      "lat"
    ];
  }

  const propertyNames = new Set();

  for (const row of rows) {
    for (const name of Object.keys(row.properties || {})) {
      propertyNames.add(name);
    }
  }

  return ["layer", ...Array.from(propertyNames).sort(), "lon", "lat"];
}

function rowToCsvValues(row, columns, fieldMap) {
  if (fieldMap && fieldMap.length) {
    const values = {
      layer: row.layer,
      lon: row.lon,
      lat: row.lat
    };

    for (const item of fieldMap) {
      values[item.alias] = row.properties?.[item.original] ?? "";
    }

    return columns.map(col => csvEscape(values[col]));
  }

  const values = {
    layer: row.layer,
    ...row.properties,
    lon: row.lon,
    lat: row.lat
  };

  return columns.map(col => csvEscape(values[col]));
}

function buildDedupeKey(row) {
  // Usamos layer + properties + coordenadas redondeadas.
  // En tiles vectoriales puede haber duplicados entre tiles contiguos.
  const props = JSON.stringify(row.properties || {}, Object.keys(row.properties || {}).sort());
  const lon = row.lon === null || row.lon === undefined ? "" : Number(row.lon).toFixed(7);
  const lat = row.lat === null || row.lat === undefined ? "" : Number(row.lat).toFixed(7);

  return `${row.layer}|${props}|${lon}|${lat}`;
}

function validateRequestedLayer(tilejson, requestedLayer) {
  if (!requestedLayer) return;

  const available = new Set((tilejson.vector_layers || []).map(layer => layer.id));

  if (!available.has(requestedLayer)) {
    throw new Error(
      `La capa --layer ${requestedLayer} no existe en el TileJSON. ` +
        `Capas disponibles: ${Array.from(available).join(", ")}`
    );
  }
}

async function extractRows({ tilejson, args }) {
  const bounds = args.bbox || tilejson.bounds;

  if (!bounds) {
    throw new Error("El TileJSON no incluye bounds. Indica uno manualmente con --bbox oeste,sur,este,norte");
  }

  const zoom = args.zoom ?? tilejson.maxzoom;

  if (!Number.isInteger(zoom)) {
    throw new Error("No se ha podido determinar el zoom. Indícalo con --zoom NUMERO");
  }

  const tileTemplate = tilejson.tiles?.[0];

  if (!tileTemplate) {
    throw new Error("El TileJSON no incluye plantilla de tiles en tiles[0]");
  }

  const selectedLayers = args.layer
    ? [args.layer]
    : (tilejson.vector_layers || []).map(layer => layer.id);

  const { xMin, xMax, yMin, yMax } = getTileRange(bounds, zoom);
  const totalTiles = (xMax - xMin + 1) * (yMax - yMin + 1);

  console.log("\nExtracción:");
  console.log(`  zoom:        ${zoom}`);
  console.log(`  bounds:      ${JSON.stringify(bounds)}`);
  console.log(`  x:           ${xMin} → ${xMax}`);
  console.log(`  y:           ${yMin} → ${yMax}`);
  console.log(`  tiles:       ${totalTiles}`);
  console.log(`  capas:       ${selectedLayers.join(", ")}`);
  console.log(`  salida:      ${args.out}`);
  console.log("");

  const rows = [];
  const seen = new Set();

  let processedTiles = 0;
  let tilesWithSelectedData = 0;
  let decodedTiles = 0;

  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      processedTiles++;

      const url = fillTileUrl(tileTemplate, args.token, zoom, x, y);
      const buffer = await fetchBuffer(url);

      if (!buffer) continue;

      let tile;

      try {
        tile = new VectorTile(new Protobuf(buffer));
        decodedTiles++;
      } catch {
        continue;
      }

      let tileHadSelectedData = false;

      for (const layerName of selectedLayers) {
        const layer = tile.layers[layerName];

        if (!layer || layer.length === 0) continue;

        tileHadSelectedData = true;

        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          const geojson = feature.toGeoJSON(x, y, zoom);
          const properties = geojson.properties || {};
          const [lon, lat] = extractRepresentativeLonLat(geojson.geometry);

          if (!args.keepEmpty && (lon === null || lat === null)) {
            continue;
          }

          const row = {
            layer: layerName,
            properties,
            lon,
            lat
          };

          const key = buildDedupeKey(row);
          if (seen.has(key)) continue;

          seen.add(key);
          rows.push(row);
        }
      }

      if (tileHadSelectedData) {
        tilesWithSelectedData++;
      }
    }

    console.log(
      `Procesado x=${x}. Tiles ${processedTiles}/${totalTiles}. Features únicas: ${rows.length}`
    );
  }

  console.log("\nResumen de descarga:");
  console.log(`  tiles procesados:       ${processedTiles}`);
  console.log(`  tiles decodificados:    ${decodedTiles}`);
  console.log(`  tiles con datos capa:   ${tilesWithSelectedData}`);
  console.log(`  features únicas:        ${rows.length}`);

  return rows;
}

function writeCsv(rows, args) {
  const columns = inferColumns(rows, args.fields);

  const csv = [
    columns.join(","),
    ...rows.map(row => rowToCsvValues(row, columns, args.fields).join(","))
  ].join("\n");

  fs.writeFileSync(args.out, csv, "utf8");

  console.log(`\nCSV creado: ${args.out}`);
  console.log(`Columnas: ${columns.join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  requireArgs(args);

  const tilejsonUrl = buildTileJSONUrl(args.tileset, args.token);
  const tilejson = await fetchJSON(tilejsonUrl);

  printTileJSONSummary(tilejson);

  if (args.listLayers) {
    return;
  }

  validateRequestedLayer(tilejson, args.layer);

  const rows = await extractRows({ tilejson, args });
  writeCsv(rows, args);
}

main().catch(error => {
  console.error("\nERROR:");
  console.error(error.message || error);
  process.exit(1);
});
