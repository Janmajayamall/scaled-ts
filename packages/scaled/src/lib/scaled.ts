import { BigNumber, Signer, utils } from 'ethers';
import { solG1 } from '@thehubbleproject/bls/dist/mcl';
import {
  aggregate,
  BlsSignerInterface,
  BlsSignerFactory,
} from '@thehubbleproject/bls/dist/signer';
import {
  Provider,
  TransactionResponse,
} from '@ethersproject/abstract-provider';
import {
  Erc20__factory,
  Router,
  Router__factory,
  StateBLS,
  StateBLS__factory,
} from 'packages/scaled/types/ethers-contracts';

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

export class Scaled {
  public stateBLS: StateBLS;
  public router: Router;

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
    signer.connect(provider);

    this.stateBLS = StateBLS__factory.connect(stateBLSAddress, signer);
    this.router = Router__factory.connect(routerAddress, signer);

    this.signer = signer;
    this.provider = provider;
    this.blsSigner = blsSigner;
  }

  /// Router related functions
  public async giveRouterApproval(
    amount: BigNumber
  ): Promise<TransactionResponse> {
    const token = Erc20__factory.connect(await this.getToken(), this.signer);
    return token.approve(this.router.address, amount);
  }

  /// StateBLS related functions
  public async getToken(): Promise<string> {
    return this.stateBLS.token();
  }

  public async getAccount(userIndex: BigNumber): Promise<{
    balance: BigNumber;
    nonce: number;
    postNonce: number;
  }> {
    return this.stateBLS.accounts(userIndex);
  }

  public async register(): Promise<TransactionResponse> {
    let address = await this.signer.getAddress();

    return this.stateBLS.register(
      address,
      this.blsSigner.pubkey,
      this.blsSigner.sign(utils.solidityPack(['address'], [address]))
    );
  }

  // TODO: Token approval to router contract
  public async fundAccount(
    userIndex: BigNumber,
    amount: BigNumber
  ): Promise<TransactionResponse> {
    return this.router.fundAccount(userIndex, amount);
  }

  public async depositSecurity(
    userIndex: BigNumber,
    amount: BigNumber
  ): Promise<TransactionResponse> {
    return await this.router.depositSecurity(userIndex, amount);
  }

  public async initWithdraw(
    userIndex: BigNumber,
    amount: BigNumber
  ): Promise<TransactionResponse> {
    let acc = await this.getAccount(userIndex);

    let signature = this.blsSigner.sign(
      utils.solidityPack(['uint32', 'uint128'], [acc.nonce + 1, amount])
    );

    return this.stateBLS.initWithdraw(userIndex, amount, signature);
  }

  public async processWithdrawal(
    userIndex: BigNumber
  ): Promise<TransactionResponse> {
    return this.stateBLS.processWithdrawal(userIndex);
  }

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
      ...utils.arrayify(this.stateBLS.interface.getSighash('post()')),
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
