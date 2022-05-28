import { BigNumber, Contract, Signer, utils } from 'ethers';
import { solG1 } from '@thehubbleproject/bls/dist/mcl';
import {
  aggregate,
  BlsSignerInterface,
  BlsSignerFactory,
} from '@thehubbleproject/bls/dist/signer';
import {
  Provider,
  TransactionRequest,
  TransactionResponse,
} from '@ethersproject/abstract-provider';

interface Receipt {
  aIndex: BigNumber;
  bIndex: BigNumber;
  amount: BigNumber;
  expiresBy: BigNumber;
  seqNo: BigNumber;
}

interface Update {
  receipt: Receipt;
  aSignature: solG1;
  bSignature: solG1;
}

const StateAbi = [
  'function post() external',
  'function register(address userAddress, uint256[4] calldata blsPk, uint256[2] calldata sk) external',
];

const RouterAbi = [
  'function fundAccount(uint64 toIndex, uint128 amount) external',
];

export class Scaled {
  public stateBLS: Contract;
  public router: Contract;

  public signer: Signer;
  public provider: Provider;
  public blsSigner: BlsSignerInterface;

  constructor(
    signer: Signer,
    blsSigner: BlsSignerInterface,
    provider: Provider,
    stateBLSAddress: string,
    routerAddress: string
  ) {
    this.stateBLS = new Contract(
      stateBLSAddress,
      StateAbi,
      signer.connect(provider)
    );

    this.router = new Contract(
      routerAddress,
      RouterAbi,
      signer.connect(provider)
    );

    this.signer = signer;
    this.provider = provider;
    this.blsSigner = blsSigner;

    signer.connect(provider);
  }

  public async register(): Promise<TransactionResponse> {
    let address = await this.signer.getAddress();

    const txReq = await this.stateBLS['register'](
      await this.signer.getAddress,
      this.blsSigner.pubkey,
      this.blsSigner.sign(utils.solidityPack(['address'], [address]))
    );

    return await txReq.wait();
  }

  public async fundAccount(amount: BigNumber): Promise<TransactionRequest> {
    // TODO validate amount

    return await this.router['fundAccount'](amount);
  }

  public async depositSecurity(amount: BigNumber): Promise<TransactionRequest> {
    return await this.router['fundAccount'](amount);
  }

  public withdrawAmount() {}

  public correctUpdate() {}

  /**
   * post
   * Post signed receipts shared with `signer` as `a`
   */
  public async post(
    aIndex: BigNumber,
    updates: Update[]
  ): Promise<TransactionResponse> {
    // aggregate signatures
    let sigs: solG1[] = [];
    updates.map((u) => {
      sigs.push(u.aSignature);
      sigs.push(u.bSignature);
    });
    let aggSig = aggregate(sigs);

    let calldata = new Uint8Array([
      // index of `a` is 1
      ...utils.arrayify(utils.solidityPack(['uint64'], [aIndex])),
      ...utils.arrayify(utils.solidityPack(['uint16'], [updates.length])),
      ...utils.arrayify(
        utils.solidityPack(['uint256', 'uint256'], [aggSig[0], aggSig[1]])
      ),
    ]);

    updates.forEach((u) => {
      if (u.receipt.aIndex != aIndex) {
        // TODO: throw error
      }

      calldata = new Uint8Array([
        ...calldata,
        ...utils.arrayify(
          utils.solidityPack(
            ['uint64', 'uint128'],
            [u.receipt.bIndex, u.receipt.amount]
          )
        ),
      ]);
    });

    calldata = new Uint8Array([
      ...utils.arrayify(this.stateBLS.interface.getSighash('post()')),
      ...calldata,
    ]);

    return await this.signer.sendTransaction(
      await this.signer.populateTransaction({
        to: this.stateBLS.address,
        data: calldata,
        value: 0,
      })
    );
  }
}

export async function newBlsSigner(
  blsDomain: Uint8Array,
  secretHex?: string
): Promise<BlsSignerInterface> {
  const blsSignerFactory = await BlsSignerFactory.new();
  return blsSignerFactory.getSigner(blsDomain, secretHex);
}
