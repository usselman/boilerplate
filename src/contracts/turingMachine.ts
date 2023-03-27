import {
    assert,
    ByteString,
    exit,
    FixedArray,
    hash256,
    len,
    method,
    prop,
    toByteString,
    SigHash,
    SmartContract,
    SmartContractLib,
} from 'scrypt-ts'

class ArrayUtils extends SmartContractLib {
    // Get the byte at the given index.
    @method()
    static getElemAt(b: ByteString, idx: bigint): ByteString {
        return b.slice(Number(idx) * 2, Number(idx) * 2 + 2)
    }

    // Set the byte at the given index.
    @method()
    static setElemAt(b: ByteString, idx: bigint, val: ByteString): ByteString {
        return b.slice(0, Number(idx) * 2) + val + b.slice(Number(idx) * 2 + 2)
    }
}

// Turing machine state
export type State = ByteString

// Alphabet symbol in each cell, 1 byte long each
export type Symbol = ByteString

// Contract state as a struct
export type StateStruct = {
    headPos: bigint
    tape: ByteString

    // Current machine state:
    curState: State
}

export type Input = {
    oldState: State
    read: symbol
}

export type Output = {
    newState: State
    write: symbol

    // Move left or right:
    moveLeft: boolean
}

// Transition function entry: input -> output
export type TransitionFuncEntry = {
    input: Input
    output: Output
}

/*
 * A Turing Machine checking balanced parentheses
 */
export class TuringMachine extends SmartContract {
    // States:
    @prop()
    static readonly STATE_A: State = toByteString('00') // Initial state
    @prop()
    static readonly STATE_B: State = toByteString('01')
    @prop()
    static readonly STATE_C: State = toByteString('02')
    @prop()
    static readonly STATE_ACCEPT: State = toByteString('03')

    // Symbols:
    @prop()
    static readonly BLANK: symbol = toByteString('00')
    @prop()
    static readonly OPEN: symbol = toByteString('01')
    @prop()
    static readonly CLOSE: symbol = toByteString('02')
    @prop()
    static readonly X: symbol = toByteString('03')

    @prop()
    static readonly LEFT: boolean = true
    @prop()
    static readonly RIGHT: boolean = false

    // Number of rules in the transition function.
    static readonly N = 8

    // Transition function table.
    @prop()
    static readonly transitionFuncTable: FixedArray<
        TransitionFuncEntry,
        typeof TuringMachine.N
    > = [
        {
            input: {
                oldState: TuringMachine.STATE_A,
                read: TuringMachine.OPEN,
            },
            output: {
                newState: TuringMachine.STATE_A,
                write: TuringMachine.OPEN,
                moveLeft: TuringMachine.RIGHT,
            },
        },
        {
            input: {
                oldState: TuringMachine.STATE_A,
                read: TuringMachine.X,
            },
            output: {
                newState: TuringMachine.STATE_A,
                write: TuringMachine.X,
                moveLeft: TuringMachine.RIGHT,
            },
        },
        {
            input: {
                oldState: TuringMachine.STATE_A,
                read: TuringMachine.CLOSE,
            },
            output: {
                newState: TuringMachine.STATE_B,
                write: TuringMachine.X,
                moveLeft: TuringMachine.LEFT,
            },
        },
        {
            input: {
                oldState: TuringMachine.STATE_A,
                read: TuringMachine.BLANK,
            },
            output: {
                newState: TuringMachine.STATE_C,
                write: TuringMachine.BLANK,
                moveLeft: TuringMachine.LEFT,
            },
        },
        {
            input: {
                oldState: TuringMachine.STATE_B,
                read: TuringMachine.OPEN,
            },
            output: {
                newState: TuringMachine.STATE_A,
                write: TuringMachine.X,
                moveLeft: TuringMachine.RIGHT,
            },
        },
        {
            input: {
                oldState: TuringMachine.STATE_B,
                read: TuringMachine.X,
            },
            output: {
                newState: TuringMachine.STATE_B,
                write: TuringMachine.X,
                moveLeft: TuringMachine.LEFT,
            },
        },
        {
            input: {
                oldState: TuringMachine.STATE_C,
                read: TuringMachine.X,
            },
            output: {
                newState: TuringMachine.STATE_C,
                write: TuringMachine.X,
                moveLeft: TuringMachine.LEFT,
            },
        },
        {
            input: {
                oldState: TuringMachine.STATE_C,
                read: TuringMachine.BLANK,
            },
            output: {
                newState: TuringMachine.STATE_ACCEPT,
                write: TuringMachine.BLANK,
                moveLeft: TuringMachine.RIGHT,
            },
        },
    ]

    @prop(true)
    states: StateStruct

    constructor(states: StateStruct) {
        super(...arguments)
        this.states = states
    }

    // ANYONECANPAY_SINGLE is used here to ignore all inputs and outputs, other than the ones contains the state
    // see https://scrypt.io/scrypt-ts/getting-started/what-is-scriptcontext#sighash-type
    @method(SigHash.ANYONECANPAY_SINGLE)
    public transit() {
        // Transition.
        const head: symbol = ArrayUtils.getElemAt(
            this.states.tape,
            this.states.headPos
        )

        // Transition table lookup.
        let found = false
        for (let i = 0; i < TuringMachine.N; i++) {
            if (!found) {
                const entry = TuringMachine.transitionFuncTable[i]
                if (
                    entry.input.oldState == this.states.curState &&
                    entry.input.read == head
                ) {
                    const output = entry.output

                    // Update state.
                    this.states.curState = output.newState

                    // Write tape head.
                    this.states.tape = ArrayUtils.setElemAt(
                        this.states.tape,
                        this.states.headPos,
                        output.write
                    )

                    // Move head.
                    this.states.headPos += output.moveLeft ? -1n : 1n

                    // Extend tape if out of bounds.
                    if (this.states.headPos < 0n) {
                        // Add 1 blank cell to the left.
                        this.states.tape =
                            TuringMachine.BLANK + this.states.tape
                        this.states.headPos = 0n
                    } else if (this.states.headPos >= len(this.states.tape)) {
                        // Add 1 blank cell to the right.
                        this.states.tape =
                            this.states.tape + TuringMachine.BLANK
                    }

                    if (this.states.curState == TuringMachine.STATE_ACCEPT) {
                        // Accept.
                        exit(true)
                    }

                    found = true
                }
            }
        }

        // Reject if no transition rule was found.
        assert(found, 'No transition table entry found.')

        // Assert correct output for next iteration of the machine.
        const output: ByteString = this.buildStateOutput(this.ctx.utxo.value)
        assert(this.ctx.hashOutputs == hash256(output), 'hashOutputs mismatch')
    }
}
