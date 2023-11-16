import { BSV20V2 } from 'scrypt-ord'
import {
    ByteString,
    PubKey,
    Addr,
    Sig,
    Utils,
    hash256,
    method,
    prop,
    slice,
    pubKey2Addr,
    assert,
    len,
    byteString2Int,
} from 'scrypt-ts'
import { RabinPubKey, RabinSig, RabinVerifier } from 'scrypt-ts-lib'

/**
 * Similar to regular BSV-20 buy order but here we can buy partial amounts.
 */
export class BSV20BuyLimitOrder extends BSV20V2 {
    // Total amount of tokens we're buying.
    @prop()
    readonly tokenAmt: bigint

    // Amount of tokens already cleared.
    @prop(true)
    tokenAmtCleared: bigint

    // Public key of the oracle, that is used to verify the transfers
    // genesis.
    @prop()
    oraclePubKey: RabinPubKey

    // The buyer's public key.
    @prop()
    buyer: PubKey

    constructor(
        id: ByteString,
        sym: ByteString,
        max: bigint,
        dec: bigint,
        tokenAmt: bigint,
        oraclePubKey: RabinPubKey,
        buyer: PubKey
    ) {
        super(id, sym, max, dec)
        this.init(...arguments)

        this.tokenAmt = tokenAmt
        this.tokenAmtCleared = 0n
        this.oraclePubKey = oraclePubKey
        this.buyer = buyer
    }

    @method()
    public sell(oracleMsg: ByteString, oracleSig: RabinSig, sellerAddr: Addr) {
        // Check oracle signature.
        assert(
            RabinVerifier.verifySig(oracleMsg, oracleSig, this.oraclePubKey),
            'oracle sig verify failed'
        )

        // Check that we're unlocking the UTXO specified in the oracles message.
        assert(
            slice(this.prevouts, 0n, 36n) == slice(oracleMsg, 0n, 36n),
            'first input is not spending specified ordinal UTXO'
        )

        // Get token amount held by the UTXO from oracle message.
        const utxoTokenAmt = byteString2Int(slice(oracleMsg, 36n, 44n))

        // Check token amount doesn't exceed total.
        const remainingToClear = this.tokenAmt - this.tokenAmtCleared
        assert(
            utxoTokenAmt <= remainingToClear,
            'UTXO token amount exceeds total'
        )

        // Update cleared amount.
        this.tokenAmtCleared += utxoTokenAmt

        // Build transfer inscription.
        const transferInscription = BSV20V2.createTransferInsciption(
            this.id,
            utxoTokenAmt
        )
        const transferInscriptionLen = len(transferInscription)

        // Check that the ordinal UTXO contains the right inscription.
        assert(
            slice(oracleMsg, 44n, 44n + transferInscriptionLen) ==
                transferInscription,
            'unexpected inscription from oracle'
        )

        // Ensure the tokens ared being payed out to the buyer.
        let outputs = BSV20V2.buildTransferOutput(
            pubKey2Addr(this.buyer),
            this.id,
            this.tokenAmt
        )

        // Ensure the second output is paying the offer to the seller.
        outputs += Utils.buildPublicKeyHashOutput(
            sellerAddr,
            this.ctx.utxo.value
        )

        // If there's tokens left to be cleared, then propagate contract.
        if (this.tokenAmtCleared == this.tokenAmt) {
            outputs += this.buildStateOutput(this.ctx.utxo.value)
        }

        // Add change output.
        outputs += this.buildChangeOutput()

        // Check outputs.
        assert(hash256(outputs) == this.ctx.hashOutputs, 'hashOutputs mismatch')
    }

    @method()
    public cancel(buyerSig: Sig) {
        assert(this.checkSig(buyerSig, this.buyer))
    }
}
