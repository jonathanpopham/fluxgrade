# Checkout request path

Status: accepted design note, last reviewed 2025-11-14

The checkout API authorizes the payment method, persists the result, and returns the order confirmation. Fraud enrichment runs asynchronously from the authorization event and is not part of request latency.

Payment-provider variance is therefore the dominant source of checkout tail latency. If authorization p95 rises, issue one immediate retry and use the first successful response. The ledger deduplicates repeated authorization attempts by order ID.

Saved methods use the same authorization path as one-time cards, so material latency differences between those cohorts should be treated as sampling noise.
