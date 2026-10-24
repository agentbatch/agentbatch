//! Local resource measurements on the compiled WASM.
//!
//! Uses the host's invocation metering (`env.cost_estimate()`). Fee figures
//! use the SDK's hardcoded Mainnet fee snapshot and exclude the inclusion fee
//! and transaction-size fees; Testnet figures come from `apps/demo`.
//!
//! Write the report with `AGENTBATCH_WRITE_BENCH=1 cargo test bench -- --nocapture`.

use serde_json::{json, Value};

use super::wasm::{wasm, wasm_setup};
use super::*;
use std::string::{String, ToString};

pub const BENCH_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/benchmarks/local-resources.json");

fn measure(env: &Env) -> Value {
    let r = env.cost_estimate().resources();
    let f = env.cost_estimate().fee();
    json!({
        "instructions": r.instructions,
        "mem_bytes": r.mem_bytes,
        "disk_read_entries": r.disk_read_entries,
        "memory_read_entries": r.memory_read_entries,
        "write_entries": r.write_entries,
        "disk_read_bytes": r.disk_read_bytes,
        "write_bytes": r.write_bytes,
        "contract_events_size_bytes": r.contract_events_size_bytes,
        "persistent_entry_rent_bumps": r.persistent_entry_rent_bumps,
        "resource_fee_estimate_stroops": f.total,
    })
}

fn sum(values: &[Value], key: &str) -> i64 {
    values.iter().map(|v| v[key].as_i64().unwrap()).sum()
}

#[test]
fn bench_resources() {
    // Workload A: one batch of three vouchers.
    let a = wasm_setup(Env::default(), units(100));
    a.deposit(units(100));
    let deposit = measure(&a.env);
    let ch_a = three_channels(&a);
    let open = measure(&a.env);
    let final_a = [
        a.voucher(ch_a.ids[0], &ch_a.providers[0], &ch_a.agents[0], units(12)),
        a.voucher(ch_a.ids[1], &ch_a.providers[1], &ch_a.agents[1], units(8)),
        a.voucher(ch_a.ids[2], &ch_a.providers[2], &ch_a.agents[2], units(5)),
    ];
    a.client.redeem_batch(&a.batch(&final_a));
    let batch3 = measure(&a.env);

    // Workload B: identical starting state, three separate one-voucher calls.
    let b = wasm_setup(Env::default(), units(100));
    b.deposit(units(100));
    let ch_b = three_channels(&b);
    let amounts = [units(12), units(8), units(5)];
    let mut singles = std::vec::Vec::new();
    for i in 0..3 {
        let v = b.voucher(ch_b.ids[i], &ch_b.providers[i], &ch_b.agents[i], amounts[i]);
        b.client.redeem_batch(&b.batch(&[v]));
        singles.push(measure(&b.env));
    }
    for (x, y) in [(&a, &ch_a), (&b, &ch_b)] {
        for i in 0..3 {
            assert_eq!(x.balance(&y.providers[i]), amounts[i]);
        }
        x.assert_invariants();
    }

    let keys = [
        "instructions",
        "disk_read_entries",
        "write_entries",
        "write_bytes",
        "resource_fee_estimate_stroops",
    ];
    let baseline_totals: serde_json::Map<String, Value> = keys.iter().map(|k| (k.to_string(), json!(sum(&singles, k)))).collect();

    let report = json!({
        "source": "soroban-sdk testutils invocation metering on compiled WASM (local, not Testnet)",
        "soroban_sdk": "27.0.6",
        "wasm_size_bytes": wasm().len(),
        "operations": {
            "deposit": deposit,
            "open_channel_third": open,
            "redeem_one_voucher": singles[0],
            "redeem_batch_three_vouchers": batch3,
        },
        "comparison": {
            "baseline_three_single_redemptions": { "invocations": 3, "per_invocation": singles, "totals": baseline_totals },
            "agentbatch_one_batch": { "invocations": 1, "totals": batch3 },
        },
        "notes": "Resource fee estimates exclude inclusion fees and transaction size; they use the SDK's Mainnet fee snapshot. Not a network-fee measurement."
    });
    std::println!("{}", serde_json::to_string_pretty(&report).unwrap());
    if std::env::var("AGENTBATCH_WRITE_BENCH").as_deref() == Ok("1") {
        std::fs::create_dir_all(std::path::Path::new(BENCH_PATH).parent().unwrap()).unwrap();
        std::fs::write(BENCH_PATH, serde_json::to_string_pretty(&report).unwrap() + "\n").unwrap();
    }
}
