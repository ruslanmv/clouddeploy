/**
 * Type definitions for ComposerGraph (mirroring backend schema)
 * This helps document what a "ComposerGraph" is for the Composer UI.
 */

export const ComposerGraphSchema = {
  nodes: [
    {
      id: "string",
      type: "string",
      label: "string",
      props: {}
    }
  ],
  edges: [
    {
      source: "string",
      target: "string",
      label: "string (optional)"
    }
  ],
  metadata: {}
};
