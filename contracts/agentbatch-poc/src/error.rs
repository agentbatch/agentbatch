use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Amount is zero or negative.
    InvalidAmount = 1,
    /// Requested allocation or withdrawal exceeds unallocated funds.
    InsufficientAvailable = 2,
    /// Provider is the contract itself, the owner, or the token.
    InvalidProvider = 3,
    /// Signer key is all zeros.
    InvalidSigner = 4,
    /// No channel record exists for the ID.
    ChannelNotFound = 5,
    EmptyBatch = 6,
    BatchTooLarge = 7,
    /// The same channel appears more than once in one batch.
    DuplicateChannel = 8,
    /// Voucher amount does not exceed the amount already redeemed.
    StaleVoucher = 9,
    /// Voucher amount exceeds the channel allocation.
    ExceedsAllocation = 10,
    ArithmeticOverflow = 11,
    /// Token is not a 7-decimal SEP-41 token.
    InvalidToken = 12,
}
