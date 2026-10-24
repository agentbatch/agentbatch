use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    #[topic]
    pub owner: Address,
    pub amount: i128,
    pub available: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelOpened {
    #[topic]
    pub channel_id: u64,
    #[topic]
    pub provider: Address,
    pub signer: BytesN<32>,
    pub allocation: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoucherRedeemed {
    #[topic]
    pub channel_id: u64,
    #[topic]
    pub provider: Address,
    /// Cumulative voucher amount now recorded as redeemed.
    pub cumulative: i128,
    /// Incremental amount transferred by this redemption.
    pub payout: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRedeemed {
    pub vouchers: u32,
    pub total_payout: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub owner: Address,
    pub amount: i128,
    pub available: i128,
}
