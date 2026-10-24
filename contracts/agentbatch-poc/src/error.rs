use soroban_sdk::contracterror;

/// Codes start at 101 so they never collide with Stellar Asset Contract
/// errors (1–15), which reach callers with the same `Error(Contract, #n)`
/// shape when a token transfer fails inside a batch.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Amount is zero or negative.
    InvalidAmount = 101,
    /// Requested allocation or withdrawal exceeds unallocated funds.
    InsufficientAvailable = 102,
    /// Provider is the contract itself, the owner, or the token.
    InvalidProvider = 103,
    /// Signer key is all zeros.
    InvalidSigner = 104,
    /// No channel record exists for the ID.
    ChannelNotFound = 105,
    EmptyBatch = 106,
    BatchTooLarge = 107,
    /// The same channel appears more than once in one batch.
    DuplicateChannel = 108,
    /// Voucher amount does not exceed the amount already redeemed.
    StaleVoucher = 109,
    /// Voucher amount exceeds the channel allocation.
    ExceedsAllocation = 110,
    ArithmeticOverflow = 111,
    /// Token does not report 7 decimals.
    InvalidToken = 112,
    /// The contract's token balance did not increase by exactly the deposit.
    TransferMismatch = 113,
}
