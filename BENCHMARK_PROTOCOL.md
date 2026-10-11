# NetFlow v1.2 benchmark protocol

1. Run the benchmark with 30 trials and 40 updates in Adaptive mode.
2. Repeat at least three full sessions with the tab active and no heavy background work.
3. Run fixed 0 ms, 1 ms, 2 ms, and 4 ms modes as controls.
4. Save CSV outputs and record browser, OS, CPU, date, and session.
5. All rows must show MATCH.

Degradation (%) = ((batched median / sequential median) - 1) × 100. The numeric threshold is <=20%.

Adaptive mode uses a microtask flush (0 ms configured wait) up to 1,000 nodes and 1 ms above that. This avoids setTimeout clamping on the tested sizes but may reduce merging of separate BroadcastChannel message tasks. A passing synthetic result does not prove end-to-end performance.

The harness excludes BroadcastChannel delivery, Cytoscape rendering, DOM report rendering, browser paint, and multi-tab contention. To establish the challenge target, instrument from the first mutation enqueue to the final committed report being rendered in both tabs, and compare equivalent sequential and concurrent workloads over at least 30 trials.
