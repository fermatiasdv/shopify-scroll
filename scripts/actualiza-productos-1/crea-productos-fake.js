// Crea (si no existen) un producto fake por fragancia, con el handle que busca el drawer de
// sections/fragrance-scroll.liquid (nombre en minúsculas y con guiones: wonder-of-the-world).
//
// Uso (desde esta carpeta, con el mismo .env que index.js):
//   node crea-productos-fake.js           -> dry run: sólo muestra qué haría
//   node crea-productos-fake.js --apply   -> crea los que falten y los publica en Online Store
import { existsSync } from 'node:fs';
import { URLSearchParams } from 'node:url';

if (existsSync('.env')) process.loadEnvFile('.env');

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APPLY = process.argv.includes('--apply');

const PRICE = '120.00';
const VENDOR = 'Fragrance demo';
const PRODUCT_TYPE = 'Fragrance';

const FRAGRANCES = [
  'Rebellious',
  'Forbidden Flower',
  'Wonder of the World',
  'Painkiller',
  'Jagged Edge',
  'Crimson Desert',
  'Glitterati',
  'Ecstasy',
  'Epicurean',
  'London Legend',
];

const handleFor = (name) => name.trim().toLowerCase().replace(/\s+/g, '-');

let token = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;

  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
  const { access_token, expires_in } = await response.json();
  token = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return token;
}

async function graphql(query, variables = {}) {
  const response = await fetch(`https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': await getToken(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(JSON.stringify(errors));
  return data;
}

function assertNoUserErrors(label, userErrors) {
  if (userErrors?.length) throw new Error(`${label}: ${JSON.stringify(userErrors)}`);
}

async function findProduct(handle) {
  const data = await graphql(
    `
      query ($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            handle
            status
          }
        }
      }
    `,
    { query: `handle:${handle}` },
  );
  return data.products.nodes[0] ?? null;
}

async function getOnlineStorePublicationId() {
  try {
    const data = await graphql(`
      {
        publications(first: 20) {
          nodes {
            id
            name
          }
        }
      }
    `);
    return data.publications.nodes.find((publication) => publication.name === 'Online Store')?.id ?? null;
  } catch (error) {
    console.warn(`No se pudieron leer los canales de venta: ${error.message}`);
    return null;
  }
}

async function publishProduct(id, handle, publicationId) {
  const published = await graphql(
    `
      mutation ($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors {
            field
            message
          }
        }
      }
    `,
    { id, input: [{ publicationId }] },
  );
  assertNoUserErrors(`publishablePublish ${handle}`, published.publishablePublish.userErrors);
}

async function createProduct(name, handle, publicationId) {
  const created = await graphql(
    `
      mutation ($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            variants(first: 1) {
              nodes {
                id
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      product: {
        title: name,
        handle,
        status: 'ACTIVE',
        vendor: VENDOR,
        productType: PRODUCT_TYPE,
        descriptionHtml: `<p>${name} — demo fragrance used to test the purchase drawer.</p>`,
      },
    },
  );
  assertNoUserErrors(`productCreate ${handle}`, created.productCreate.userErrors);
  const { id, variants } = created.productCreate.product;

  // Precio + vender sin stock (CONTINUE) para que la variante figure como disponible sin cargar inventario.
  const updated = await graphql(
    `
      mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      productId: id,
      variants: [{ id: variants.nodes[0].id, price: PRICE, inventoryPolicy: 'CONTINUE' }],
    },
  );
  assertNoUserErrors(`productVariantsBulkUpdate ${handle}`, updated.productVariantsBulkUpdate.userErrors);

  if (publicationId) await publishProduct(id, handle, publicationId);
  return id;
}

async function main() {
  console.log(APPLY ? 'Modo --apply: se crean los productos que falten.' : 'Dry run (agregá --apply para crear).');

  const publicationId = APPLY ? await getOnlineStorePublicationId() : null;
  if (APPLY && !publicationId) {
    console.warn(
      'Sin acceso al canal "Online Store" (faltan los scopes read_publications y write_publications): ' +
        'los productos se crean sin publicar. Publicalos a mano en el admin o agregá los scopes y volvé a correr el script.',
    );
  }

  for (const name of FRAGRANCES) {
    const handle = handleFor(name);
    const existing = await findProduct(handle);
    if (existing) {
      // publishablePublish es idempotente: sirve para publicar los que quedaron creados sin publicar.
      if (APPLY && publicationId) await publishProduct(existing.id, handle, publicationId);
      console.log(`= ${handle}: ya existe (${existing.status}), no se vuelve a crear`);
      continue;
    }
    if (!APPLY) {
      console.log(`+ ${handle}: se crearía "${name}" a ${PRICE}`);
      continue;
    }
    const id = await createProduct(name, handle, publicationId);
    console.log(`+ ${handle}: creado (${id})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
