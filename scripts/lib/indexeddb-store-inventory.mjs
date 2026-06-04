export const EXPECTED_INDEXEDDB_STORES = [
  "users",
  "customers",
  "suppliers",
  "items",
  "categories",
  "brands",
  "units",
  "discounts",
  "taxes",
  "expenses",
  "expCategories",
  "settings",
  "customer_payments",
  "supplier_payments",
  "sales",
  "sale_items",
  "held",
  "held_items",
  "item_batches",
  "cylinders",
  "cylinder_customers",
  "sync_queue",
];

export const BUSINESS_CRITICAL_INDEXEDDB_STORES = [
  "users",
  "customers",
  "suppliers",
  "items",
  "categories",
  "brands",
  "units",
  "discounts",
  "taxes",
  "expenses",
  "expCategories",
  "settings",
  "customer_payments",
  "supplier_payments",
  "sales",
  "sale_items",
  "held",
  "held_items",
  "item_batches",
  "cylinders",
  "cylinder_customers",
  "sync_queue",
];

export function compareStoreCoverage(actualStores, expectedStores = EXPECTED_INDEXEDDB_STORES) {
  const actual = new Set(actualStores);
  const expected = new Set(expectedStores);

  return {
    expectedStores,
    actualStores: [...actual].sort(),
    missingStores: expectedStores.filter((store) => !actual.has(store)),
    unexpectedStores: [...actual].filter((store) => !expected.has(store)).sort(),
  };
}
