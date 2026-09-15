import { existsSync } from 'node:fs';
import { URLSearchParams } from 'node:url';

if (existsSync('.env')) process.loadEnvFile('.env');

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

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

async function main() {
  const data = await graphql(
  `
  {
    product(id: "gid://shopify/Product/9549136756973") {
      id
      title
      options {
        name
        values
      }
      variants(first: 20, reverse: true) {
        edges {
          node {
            id
            title
            sku
            price
            inventoryQuantity
            selectedOptions {
              name
              value
            }
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`);
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);