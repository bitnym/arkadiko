import React, { useContext, useEffect, useState } from 'react';
import { AppContext } from '@common/context';
import { Container } from './home';
import { SwitchVerticalIcon, InformationCircleIcon, PlusCircleIcon, MinusCircleIcon } from '@heroicons/react/solid';
import { Tooltip } from '@blockstack/ui';
import { NavLink as RouterLink } from 'react-router-dom'


import { microToReadable } from '@common/vault-utils';
import {
  callReadOnlyFunction, cvToJSON,
  contractPrincipalCV, uintCV,
  createAssetInfo, FungibleConditionCode,
  makeStandardFungiblePostCondition,
  makeStandardSTXPostCondition
} from '@stacks/transactions';
import { useSTXAddress } from '@common/use-stx-address';
import { stacksNetwork as network } from '@common/utils';
import { useConnect } from '@stacks/connect-react';
import { tokenTraits } from '@common/vault-utils';
import { TokenSwapList, tokenList } from '@components/token-swap-list';
import { SwapSettings } from '@components/swap-settings';
import { getBalance } from '@components/app';

function classNames(...classes) {
  return classes.filter(Boolean).sort().join(' ')
}

export const Swap: React.FC = () => {
  const [state, setState] = useContext(AppContext);
  const [tokenX, setTokenX] = useState(tokenList[0]);
  const [tokenY, setTokenY] = useState(tokenList[1]);
  const [tokenXAmount, setTokenXAmount] = useState();
  const [tokenYAmount, setTokenYAmount] = useState(0.0);
  const [balanceSelectedTokenX, setBalanceSelectedTokenX] = useState(0.0);
  const [balanceSelectedTokenY, setBalanceSelectedTokenY] = useState(0.0);
  const [currentPrice, setCurrentPrice] = useState(0.0);
  const [currentPair, setCurrentPair] = useState();
  const [inverseDirection, setInverseDirection] = useState(false);
  const [slippageTolerance, setSlippageTolerance] = useState(0.4);
  const [minimumReceived, setMinimumReceived] = useState(0);
  const [priceImpact, setPriceImpact] = useState('0');
  const [lpFee, setLpFee] = useState('0');
  const [foundPair, setFoundPair] = useState(true);
  const defaultFee = 0.4;

  const stxAddress = useSTXAddress();
  const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS || '';
  const { doContractCall, doOpenAuth } = useConnect();

  const setTokenBalances = () => {
    setBalanceSelectedTokenX(microToReadable(state.balance[tokenX['name'].toLowerCase()]));
    setBalanceSelectedTokenY(microToReadable(state.balance[tokenY['name'].toLowerCase()]));
  };

  useEffect(() => {
    setTokenBalances();
  }, [state.balance]);

  useEffect(() => {
    const fetchBalance = async () => {
      const account = await getBalance(stxAddress || '');

      setTokenXAmount(undefined);
      setTokenYAmount(0.0);
      setMinimumReceived(0);
      setPriceImpact('0');
      setLpFee('0');
      setState(prevState => ({
        ...prevState,
        balance: {
          usda: account.usda.toString(),
          diko: account.diko.toString(),
          stx: account.stx.toString(),
          xstx: account.xstx.toString(),
          stdiko: account.stdiko.toString(),
          dikousda: account.dikousda.toString(),
          wstxusda: account.wstxusda.toString(),
          wstxdiko: account.wstxdiko.toString()
        }
      }));
    };

    if (state.currentTxStatus === 'success') {
      fetchBalance();
    }
  }, [state.currentTxStatus]);

  useEffect(() => {
    const fetchPair = async (tokenXContract:string, tokenYContract:string) => {
      let details = await callReadOnlyFunction({
        contractAddress,
        contractName: "arkadiko-swap-v1-1",
        functionName: "get-pair-details",
        functionArgs: [
          contractPrincipalCV(contractAddress, tokenXContract),
          contractPrincipalCV(contractAddress, tokenYContract)
        ],
        senderAddress: stxAddress || contractAddress,
        network: network,
      });

      return cvToJSON(details);
    };

    const resolvePair = async () => {
      if (state?.balance) {
        setTokenBalances();
      }
      setTokenXAmount(0.0);
      setTokenYAmount(0.0);

      let tokenXContract = tokenTraits[tokenX['name'].toLowerCase()]['swap'];
      let tokenYContract = tokenTraits[tokenY['name'].toLowerCase()]['swap'];
      const json3 = await fetchPair(tokenXContract, tokenYContract);
      console.log('Pair Details:', json3);
      if (json3['success']) {
        setCurrentPair(json3['value']['value']['value']);
        const balanceX = json3['value']['value']['value']['balance-x'].value;
        const balanceY = json3['value']['value']['value']['balance-y'].value;
        const basePrice = (balanceX / balanceY).toFixed(2);
        // const price = parseFloat(basePrice) + (parseFloat(basePrice) * 0.01);
        setCurrentPrice(basePrice);
        setInverseDirection(false);
        setFoundPair(true);
      } else if (json3['value']['value']['value'] === 201) {
        const json4 = await fetchPair(tokenYContract, tokenXContract);
        if (json4['success']) {
          console.log('found pair...', json4);
          setCurrentPair(json4['value']['value']['value']);
          setInverseDirection(true);
          const balanceX = json4['value']['value']['value']['balance-x'].value;
          const balanceY = json4['value']['value']['value']['balance-y'].value;
          const basePrice = (balanceY / balanceX).toFixed(2);
          setCurrentPrice(basePrice);
          setFoundPair(true);
        } else {
          setFoundPair(false);
        }
      } else {
        setFoundPair(false);
      }
    };

    resolvePair();
  }, [tokenX, tokenY]);

  useEffect(() => {
    if (currentPrice > 0) {
      calculateTokenYAmount();
    }
  }, [tokenXAmount, slippageTolerance]);

  const calculateTokenYAmount = () => {
    if (!currentPair || tokenXAmount === 0 || tokenXAmount === undefined) {
      return;
    }

    const balanceX = currentPair['balance-x'].value;
    const balanceY = currentPair['balance-y'].value;
    let amount = 0;
    let tokenYAmount = 0;

    const slippage = (100 - slippageTolerance) / 100;
    // amount = ((slippage * balanceY * tokenXAmount) / ((1000 * balanceX) + (997 * tokenXAmount))).toFixed(6);
    if (inverseDirection) {
      amount = slippage * (balanceX / balanceY) * Number(tokenXAmount);
      tokenYAmount = ((100 - defaultFee) / 100) * (balanceX / balanceY) * Number(tokenXAmount);
    } else {
      amount = slippage * (balanceY / balanceX) * Number(tokenXAmount);
      tokenYAmount = ((100 - defaultFee) / 100) * (balanceY / balanceX) * Number(tokenXAmount);
    }
    setMinimumReceived((amount * 0.97));
    setTokenYAmount(tokenYAmount);
    const impact = ((balanceX / 1000000) / tokenXAmount);
    setPriceImpact((100 / impact).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }));
    setLpFee((0.003 * tokenXAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }));
  };

  const onInputChange = (event: { target: { name: any; value: any; }; }) => {
    const name = event.target.name;
    const value = event.target.value;

    if (name === 'tokenXAmount') {
      setTokenXAmount(value);
    } else {
      setTokenYAmount(value);
    }
  };

  const switchTokens = () => {
    const tmpTokenX = tokenX;
    setTokenX(tokenY);
    setTokenY(tmpTokenX);
    setTokenXAmount(0.0);
    setTokenYAmount(0.0);
  };

  const setDefaultSlippage = () => {
    setSlippageTolerance(0.4);
  };

  const setMaximum = () => {
    if (tokenX['name'].toLowerCase() === 'stx') {
      setTokenXAmount(parseInt(balanceSelectedTokenX, 10) - 1);
    } else {
      setTokenXAmount(parseInt(balanceSelectedTokenX, 10));
    }
  };

  const swapTokens = async () => {
    let contractName = 'swap-x-for-y';
    let tokenXTrait = tokenTraits[tokenX['name'].toLowerCase()]['swap'];
    let tokenYTrait = tokenTraits[tokenY['name'].toLowerCase()]['swap'];
    let postConditionTrait = tokenXTrait;
    let postConditionName = tokenX['name'].toLowerCase();
    if (inverseDirection) {
      contractName = 'swap-y-for-x';
      let tmpTrait = tokenXTrait;
      tokenXTrait = tokenYTrait;
      tokenYTrait = tmpTrait;
    }

    const amount = uintCV(tokenXAmount * 1000000);
    let postConditions = [];
    if (tokenX.name === 'STX') {
      postConditions = [
        makeStandardSTXPostCondition(
          stxAddress || '',
          FungibleConditionCode.Equal,
          amount.value
        )
      ];
    } else {
      postConditions = [
        makeStandardFungiblePostCondition(
          stxAddress || '',
          FungibleConditionCode.Equal,
          amount.value,
          createAssetInfo(
            contractAddress,
            postConditionTrait,
            postConditionName
          )
        )
      ];
    }
    await doContractCall({
      network,
      contractAddress,
      stxAddress,
      contractName: 'arkadiko-swap-v1-1',
      functionName: contractName,
      functionArgs: [
        contractPrincipalCV(contractAddress, tokenXTrait),
        contractPrincipalCV(contractAddress, tokenYTrait),
        amount,
        uintCV(parseFloat(minimumReceived) * 1000000)
      ],
      postConditionMode: 0x01,
      postConditions,
      finished: data => {
        console.log('finished swap!', data);
        setState(prevState => ({
          ...prevState,
          showTxModal: true,
          currentTxMessage: '',
          currentTxId: data.txId,
          currentTxStatus: 'pending'
        }));
      },
    });
  };

  return (
    <Container>
      <main className="flex-1 relative pb-8 flex flex-col items-center justify-center py-12">
        <div className="w-full max-w-lg bg-white shadow rounded-lg relative z-10">
          <div className="flex flex-col p-4">
            <div className="flex justify-between mb-4">
              <h2 className="text-lg leading-6 font-medium text-gray-900">
                Swap Tokens
              </h2>
              <SwapSettings
                slippageTolerance={slippageTolerance}
                setDefaultSlippage={setDefaultSlippage}
                setSlippageTolerance={setSlippageTolerance}
              />
            </div>

            <form>
              <div className="rounded-md shadow-sm bg-gray-50 border border-gray-200 hover:border-gray-300 focus-within:border-indigo-200">
                <div className="flex items-center p-4 pb-2">

                  <TokenSwapList
                    selected={tokenX}
                    setSelected={setTokenX}
                  />

                  <label htmlFor="tokenXAmount" className="sr-only">{tokenX.name}</label>
                  <input
                    type="number"
                    inputMode="decimal" 
                    autoFocus={true}
                    autoComplete="off"
                    autoCorrect="off"
                    name="tokenXAmount"
                    id="tokenXAmount"
                    pattern="^[0-9]*[.,]?[0-9]*$"
                    placeholder="0.0"
                    value={tokenXAmount || ''}
                    onChange={onInputChange}
                    className="ml-4 font-semibold focus:outline-none focus:ring-0 border-0 bg-gray-50 text-xl truncate p-0 m-0 text-right flex-1"
                    style={{appearance: 'textfield'}} />
                </div>

                <div className="flex items-center text-sm p-4 pt-0 justify-end">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center justify-start">
                      <p className="text-gray-500">Balance: {balanceSelectedTokenX.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {tokenX.name}</p>
                      {parseInt(balanceSelectedTokenX, 10) > 0 ? (
                        <button
                          type="button"
                          onClick={() => setMaximum()}
                          className="ml-2 rounded-md font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-100 p-1 text-xs focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-indigo-500"
                        >
                          Max.
                        </button>
                      ) : `` }
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={switchTokens}
                className="-mb-4 -ml-4 -mt-4 bg-white border border-gray-300 flex h-8 bg-white  items-center justify-center left-1/2 relative rounded-md text-gray-400 transform w-8 z-10 hover:text-indigo-700 focus:outline-none focus:ring-offset-0 focus:ring-1 focus:ring-indigo-500"
              >
                <SwitchVerticalIcon className="h-5 w-5" aria-hidden="true" />
              </button>

              <div className="rounded-md shadow-sm bg-gray-50 border border-gray-200 hover:border-gray-300 focus-within:border-indigo-200 mt-1">
                <div className="flex items-center p-4 pb-2">

                  <TokenSwapList
                    selected={tokenY}
                    setSelected={setTokenY}
                  />

                  <label htmlFor="tokenYAmount" className="sr-only">{tokenY.name}</label>
                  <input 
                    inputMode="decimal"
                    autoComplete="off"
                    autoCorrect="off"
                    type="text"
                    name="tokenYAmount"
                    id="tokenYAmount"
                    pattern="^[0-9]*[.,]?[0-9]*$" 
                    placeholder="0.0"
                    value={tokenYAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    onChange={onInputChange}
                    disabled={true}
                    className="ml-4 font-semibold focus:outline-none focus:ring-0 border-0 bg-gray-50 text-xl truncate p-0 m-0 text-right flex-1 text-gray-600" />
                </div>

                <div className="flex items-center text-sm p-4 pt-0 justify-end">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center justify-start">
                      <p className="text-gray-500">Balance: {balanceSelectedTokenY.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {tokenY.name}</p>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-sm mt-2 font-semibold text-right text-gray-400">1 {tokenY.name} = ≈{currentPrice} {tokenX.name}</p>

              {state.userData ? (
                <button
                  type="button"
                  disabled={tokenYAmount === 0 || !foundPair}
                  onClick={() => swapTokens()}
                  className={classNames((tokenYAmount === 0 || !foundPair) ? 
                    'bg-indigo-300 hover:bg-indigo-300 pointer-events-none' :
                    'bg-indigo-600 hover:bg-indigo-700 cursor-pointer', 
                    'w-full mt-4 inline-flex items-center justify-center text-center px-4 py-3 border border-transparent shadow-sm font-medium text-xl rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500')}
                >
                  { !foundPair ? "No liquidity for this pair. Try another one."
                  : balanceSelectedTokenX === 0 ? "Insufficient balance"
                  : tokenYAmount === 0 ? "Please enter an amount"
                  : "Swap"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => doOpenAuth()}
                  className="w-full mt-4 inline-flex items-center justify-center text-center px-4 py-3 border border-transparent shadow-sm font-medium text-xl rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Connect Wallet
                </button>
              )}
            </form>
            { foundPair ? (
              <div className="mt-3 w-full text-center">
                <RouterLink className="text-sm font-medium text-indigo-700 hover:underline focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 rounded-sm" to={`swap/add/${tokenX.name}/${tokenY.name}`}>
                  Add/remove liquidity on {tokenX.name}-{tokenY.name}
                </RouterLink>
              </div>
            ) : null }
          </div>
        </div>
        <div className="-mt-4 p-4 pt-8 w-full max-w-md bg-indigo-50 border border-indigo-200 shadow-sm rounded-lg">
          <dl className="space-y-1">
            <div className="sm:grid sm:grid-cols-2 sm:gap-4">
              <dt className="text-sm font-medium text-indigo-500 inline-flex items-center">
                Minimum Received
                <div className="ml-2">
                  <Tooltip className="z-10" shouldWrapChildren={true} label={`Your transaction will revert if there is a large, unfavorable price movement before it is confirmed`}>
                    <InformationCircleIcon className="block h-4 w-4 text-indigo-400" aria-hidden="true" />
                  </Tooltip>
                </div>
              </dt>
              <dd className="font-semibold mt-1 sm:mt-0 text-indigo-900 text-sm sm:justify-end sm:inline-flex">
                <div className="truncate mr-1">{minimumReceived.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>
                {tokenY.name}
              </dd>
            </div>
            <div className="sm:grid sm:grid-cols-2 sm:gap-4">
              <dt className="text-sm font-medium text-indigo-500 inline-flex items-center">
                Price Impact
                <div className="ml-2">
                  <Tooltip className="z-10" shouldWrapChildren={true} label={`The difference between the market price and estimated price due to trade size`}>
                    <InformationCircleIcon className="block h-4 w-4 text-indigo-400" aria-hidden="true" />
                  </Tooltip>
                </div>
              </dt>
              <dd className="font-semibold mt-1 sm:mt-0 text-indigo-900 text-sm sm:justify-end sm:inline-flex">
                ≈<div className="truncate mr-1">{priceImpact}</div>
                %
              </dd>
            </div>
            <div className="sm:grid sm:grid-cols-2 sm:gap-4">
              <dt className="text-sm font-medium text-indigo-500 inline-flex items-center">
                Liquidity Provider fee
                <div className="ml-2">
                  <Tooltip className="z-10" shouldWrapChildren={true} label={`A portion of each trade goes to liquidity providers as a protocol incentive`}>
                    <InformationCircleIcon className="block h-4 w-4 text-indigo-400" aria-hidden="true" />
                  </Tooltip>
                </div>
              </dt>
              <dd className="font-semibold mt-1 sm:mt-0 text-indigo-900 text-sm sm:justify-end sm:inline-flex">
                <div className="truncate mr-1">{lpFee}</div>
                {tokenX.name}
              </dd>
            </div>
          </dl>
        </div>
      </main>
    </Container>
  );
};
