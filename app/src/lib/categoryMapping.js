/**
 * Category mapping: DB value → UI filter label
 *
 * To add a new mapping:
 *   1. Add the DB category string as a key
 *   2. Set the value to the matching UI filter label in SignalsIndexPage
 *
 * To add a new UI filter category:
 *   1. Add the label to the `categories` array in SignalsIndexPage
 *   2. Add the corresponding DB → UI mappings here
 *
 * Multi-category support: if a DB category should appear under multiple UI
 * filters in future, replace the string value with an array and update
 * mapCategory() and the filter predicate accordingly.
 */

export const CATEGORY_MAP = {
  // AI / ML signals
  "AI": "AI & ML",

  // Life sciences → Science
  "Pharma": "Science",
  "Biology": "Science",
  "Climate": "Science",

  // Future mappings (add DB category keys as they appear):
  // "Policy": "Policy",
  // "Regulation": "Policy",
  // "Safety": "Safety",
  // "Biosafety": "Safety",
  // "Macro": "Economics",
  // "Finance": "Economics",
};

/**
 * Map a raw DB category string to its UI filter label.
 * Falls back to the original value if no mapping is defined,
 * so unmapped categories still display rather than disappearing.
 *
 * @param {string | null | undefined} dbCategory
 * @returns {string | null}
 */
export function mapCategory(dbCategory) {
  if (!dbCategory) return null;
  return CATEGORY_MAP[dbCategory] ?? dbCategory;
}
