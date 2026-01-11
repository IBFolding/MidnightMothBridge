'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, getAddress, zeroPadValue } from 'ethers';
import { CHAINS, CONTRACTS, UI } from '@/src/lib/constants';
import { ERC721_ABI, ONFT_ADAPTER_ABI } from '@/src/lib/abi';

type TxPhase =
  | 'idle'
  | 'switching'
  | 'scanning'
  | 'ready'
  | 'approving'
  | 'quoting'
  | 'sending'
  | 'success'
  | 'error';

type MothItem = {
  tokenId: bigint;
  tokenURI?: string;
  image?: string;
  name?: string;
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function ipfsToHttp(uri: string) {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) return UI.ipfsGateway + uri.replace('ipfs://', '');
  return uri;
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

function addrToTopic(addr: string) {
  // 32-byte topic of an address
  const a = addr.toLowerCase().replace(/^0x/, '');
  return '0x' + a.padStart(64, '0');
}

function safeBigIntTopic(topic: string): bigint {
  try {
    return BigInt(topic);
  } catch {
    return 0n;
  }
}

export default function Page() {
  const [wallet, setWallet] = useState<string>('');
  const [chainId, setChainId] = useState<number | null>(null);

  const [manualTokenId, setManualTokenId] = useState<string>('');
  const [moths, setMoths] = useState<MothItem[]>([]);
  const [selected, setSelected] = useState<bigint | null>(null);

  const [txPhase, setTxPhase] = useState<TxPhase>('idle');
  const [txHash, setTxHash] = useState<string>('');
  const [status, setStatus] = useState<string>('Connect your wallet, then scan for your Midnight Moths.');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasEth, setHasEth] = useState(false);

  const shortWallet = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Not connected';

  // Read-only Sonic provider for scanning/preview — does NOT depend on the wallet network.
  const sonicRpc = useMemo(() => new JsonRpcProvider(CHAINS.sonic.rpcUrl), []);
  const nftRead = useMemo(
    () => new Contract(CONTRACTS.sonic.originalNft, ERC721_ABI, sonicRpc),
    [sonicRpc]
  );
  const adapterRead = useMemo(
    () => new Contract(CONTRACTS.sonic.adapter, ONFT_ADAPTER_ABI, sonicRpc),
    [sonicRpc]
  );

  useEffect(() => {
    setHasEth(typeof window !== 'undefined' && !!(window as any)?.ethereum);

    // Try to hydrate wallet+chain if already connected
    refreshChainFromWallet();

    const eth = typeof window !== 'undefined' ? (window as any).ethereum : undefined;
    if (!eth?.on) return;

    const onChainChanged = () => refreshChainFromWallet();
    const onAccountsChanged = (accs: string[]) => setWallet(accs?.[0] ? getAddress(accs[0]) : '');

    eth.on('chainChanged', onChainChanged);
    eth.on('accountsChanged', onAccountsChanged);

    return () => {
      eth.removeListener?.('chainChanged', onChainChanged);
      eth.removeListener?.('accountsChanged', onAccountsChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getChainId = async (): Promise<number | null> => {
    try {
      const eth = (window as any).ethereum;
      if (!eth?.request) return null;
      const hex = await eth.request({ method: 'eth_chainId' });
      if (typeof hex !== 'string') return null;
      return parseInt(hex, 16);
    } catch {
      return null;
    }
  };

  async function refreshChainFromWallet() {
    const eth = typeof window !== 'undefined' ? (window as any).ethereum : undefined;
    if (!eth?.request) return;

    try {
      const cidHex: string = await eth.request({ method: 'eth_chainId' });
      const cId = parseInt(cidHex, 16);
      setChainId(cId);

      const accounts: string[] = await eth.request({ method: 'eth_accounts' });
      if (accounts?.[0]) setWallet(getAddress(accounts[0]));
    } catch (e) {
      console.error(e);
    }
  }

  const switchToChain = async (targetChainId: number) => {
    const eth = (window as any).ethereum;
    if (!eth?.request) throw new Error('No injected wallet found.');
    const chainIdHex = '0x' + targetChainId.toString(16);

    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    } catch (e: any) {
      // 4902 = chain not added
      if (e?.code === 4902 && targetChainId === CHAINS.sonic.chainId) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainIdHex,
              chainName: 'Sonic',
              nativeCurrency: { name: 'S', symbol: 'S', decimals: 18 },
              rpcUrls: CHAINS.sonic.walletRpcUrls,
              blockExplorerUrls: [CHAINS.sonic.explorer]
            }
          ]
        });
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
        return;
      }
      throw e;
    }
  };

  async function connect() {
    const eth = typeof window !== 'undefined' ? (window as any).ethereum : undefined;
    if (!eth) {
      setTxPhase('error');
      setStatus('No injected wallet found. Open this in Coinbase Wallet / MetaMask / a wallet browser.');
      return;
    }

    try {
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
      const addr = accounts?.[0] ? getAddress(accounts[0]) : '';
      setWallet(addr);
      await refreshChainFromWallet();
      setTxPhase('ready');
      setStatus('Connected. Switch to Sonic to scan and bridge your Moths.');
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Connect cancelled or failed: ${e?.message ?? String(e)}`);
    }
  }

  async function ensureSonic() {
    if (!hasEth) {
      setStatus('No injected wallet found. Open this in a wallet browser.');
      return;
    }
    setTxPhase('switching');
    try {
      const cid = await getChainId();
      if (cid !== CHAINS.sonic.chainId) {
        await switchToChain(CHAINS.sonic.chainId);
        await refreshChainFromWallet();
      }
      setTxPhase('ready');
      setStatus('Wallet is on Sonic. You can scan now.');
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Failed to switch: ${e?.message ?? String(e)}`);
    }
  }

  async function ensureBase() {
    if (!hasEth) {
      setStatus('No injected wallet found. Open this in a wallet browser.');
      return;
    }
    setTxPhase('switching');
    try {
      const cid = await getChainId();
      if (cid !== CHAINS.base.chainId) {
        await switchToChain(CHAINS.base.chainId);
        await refreshChainFromWallet();
      }
      setTxPhase('ready');
      setStatus('Wallet is on Base.');
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Failed to switch: ${e?.message ?? String(e)}`);
    }
  }

  async function loadOneMoth(id: bigint): Promise<MothItem> {
    let uri = '';
    try {
      uri = await nftRead.tokenURI(id);
    } catch {
      uri = '';
    }

    let meta: any = {};
    if (uri) meta = await fetchJson(ipfsToHttp(uri));

    return {
      tokenId: id,
      tokenURI: uri || undefined,
      name: typeof meta?.name === 'string' ? meta.name : undefined,
      image: typeof meta?.image === 'string' ? ipfsToHttp(meta.image) : undefined
    };
  }

  // Scan strategy:
  // 1) Read balanceOf(wallet) from Sonic RPC.
  // 2) Find candidate tokenIds by scanning Transfer(to=wallet) logs backwards until we have enough candidates.
  // 3) Verify ownership via ownerOf for each candidate, then fetch tokenURI + metadata.
  async function scanWallet() {
    if (!wallet) return;

    setTxPhase('scanning');
    setStatus('Scanning Sonic for Midnight Moths...');
    setMoths([]);
    setSelected(null);
    setTxHash('');

    try {
      const normalizedWallet = getAddress(wallet);
      const balanceBn = await nftRead.balanceOf(normalizedWallet);
      const balance = Number(balanceBn);

      if (balance === 0) {
        setTxPhase('idle');
        setStatus('No Midnight Moths found on Sonic in this wallet.');
        return;
      }

      const latest = await sonicRpc.getBlockNumber();
      const maxBlocks = UI.scanBlocks ?? 2500000;
      const chunk = UI.scanChunkSize ?? 50000;

      const toTopic = addrToTopic(normalizedWallet);
      const candidates = new Set<string>();

      setStatus(`You have ${balance} Moth(s). Searching recent transfers on Sonic...`);

      let scanned = 0;
      for (let end = latest; end >= 0 && scanned < maxBlocks && candidates.size < balance * 6; end -= chunk) {
        const start = Math.max(0, end - chunk + 1);

        const logs = await sonicRpc.getLogs({
          address: CONTRACTS.sonic.originalNft,
          fromBlock: start,
          toBlock: end,
          topics: [TRANSFER_TOPIC, null, toTopic]
        });

        for (const log of logs) {
          const tokenTopic = log.topics?.[3];
          if (!tokenTopic) continue;
          const tokenId = safeBigIntTopic(tokenTopic);
          if (tokenId > 0n) candidates.add(tokenId.toString());
        }

        scanned += (end - start + 1);
        if (candidates.size > 0) {
          setStatus(`Found ${candidates.size} candidate token(s)… verifying ownership…`);
        }
      }

      // If we didn't find anything (rare), we can still allow manual add.
      if (candidates.size === 0) {
        setTxPhase('idle');
        setStatus('Scan found no candidate transfers. If you know a tokenId, add it manually.');
        return;
      }

      const ids = Array.from(candidates).map((s) => BigInt(s)).sort((a, b) => (a > b ? -1 : 1));

      const owned: bigint[] = [];
      for (const id of ids) {
        if (owned.length >= balance) break;
        try {
          const owner = await nftRead.ownerOf(id);
          if (getAddress(owner) === normalizedWallet) owned.push(id);
        } catch {
          // token might not exist anymore / burned / etc
        }
      }

      if (owned.length === 0) {
        setTxPhase('idle');
        setStatus('Could not verify any owned Moths from scan. Try adding a tokenId manually.');
        return;
      }

      setStatus(`Verified ${owned.length} owned Moth(s). Loading previews…`);

      const items: MothItem[] = [];
      for (const id of owned) {
        items.push(await loadOneMoth(id));
      }

      setMoths(items);
      setTxPhase('idle');
      setStatus(`Loaded ${items.length} Moth(s). Click one to preview + send.`);
    } catch (e: any) {
      console.error(e);
      setTxPhase('error');
      setStatus(`Scan failed: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function addManualToken() {
    if (!wallet || !manualTokenId) return;

    const normalizedWallet = getAddress(wallet);

    try {
      const id = BigInt(manualTokenId.trim());
      if (id < 0n) throw new Error('Invalid tokenId.');
      if (moths.some((m) => m.tokenId === id)) {
        setStatus(`Moth #${id.toString()} is already loaded.`);
        setManualTokenId('');
        return;
      }

      setStatus(`Checking ownership for token #${id.toString()}...`);
      const owner = await nftRead.ownerOf(id);
      if (getAddress(owner) !== normalizedWallet) {
        setStatus(`You do not own Moth #${id.toString()} on Sonic (or token does not exist).`);
        return;
      }

      const item = await loadOneMoth(id);
      setMoths((prev) => [item, ...prev]);
      setManualTokenId('');
      setStatus(`Added Moth #${id.toString()}.`);
    } catch (e: any) {
      setStatus(`Could not verify tokenId on Sonic: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  function selectMoth(id: bigint) {
    setSelected(id);
    setStatus(`Selected Moth #${id.toString()}. Approve, then send.`);
  }

  async function approveAdapter() {
    if (!selected || !wallet) return;

    // approvals must be done on Sonic in the wallet
    await ensureSonic();

    setTxPhase('approving');
    setStatus('Checking approval on Sonic…');

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const nftWrite = new Contract(CONTRACTS.sonic.originalNft, ERC721_ABI, signer);

      const normalizedWallet = getAddress(wallet);
      const approved = await nftWrite.isApprovedForAll(normalizedWallet, CONTRACTS.sonic.adapter);

      if (!approved) {
        setStatus('Confirm approval in your wallet…');
        const tx = await nftWrite.setApprovalForAll(CONTRACTS.sonic.adapter, true);
        setTxHash(tx.hash);
        setStatus('Approving… waiting for confirmation…');
        await tx.wait();
      }

      setTxPhase('ready');
      setStatus('Adapter approved. You can send this Moth to Base.');
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Approval failed: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function sendSelected() {
    if (selected == null || !wallet) return;

    // sending must be done on Sonic in the wallet
    await ensureSonic();

    setTxHash('');
    setTxPhase('quoting');
    setStatus('Quoting LayerZero fee…');

    try {
      const normalizedWallet = getAddress(wallet);

      const sendParam = {
        dstEid: CONTRACTS.layerzero.baseEid,
        to: zeroPadValue(normalizedWallet, 32), // bytes32 recipient
        tokenId: selected,
        extraOptions: '0x',
        composeMsg: '0x',
        onftCmd: '0x'
      };

      const quote = await adapterRead.quoteSend(sendParam, false);
      const nativeFee: bigint = quote.nativeFee ?? quote[0];
      const lzTokenFee: bigint = quote.lzTokenFee ?? quote[1];

      setTxPhase('sending');
      setStatus('Confirm the send transaction in your wallet…');

      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const adapterWrite = new Contract(CONTRACTS.sonic.adapter, ONFT_ADAPTER_ABI, signer);

      const tx = await adapterWrite.sendFrom(
        normalizedWallet,
        sendParam,
        { nativeFee, lzTokenFee },
        normalizedWallet,
        { value: nativeFee }
      );

      setTxHash(tx.hash);
      setStatus('Sent. Waiting for confirmation…');
      await tx.wait();

      setTxPhase('success');
      setStatus(`Sent! Moth #${selected.toString()} is bridging to Base. It can take a minute.`);

      setMoths((prev) => prev.filter((m) => m.tokenId !== selected));
      setSelected(null);
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Send failed: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  const selectedItem = useMemo(
    () => (selected == null ? null : moths.find((m) => m.tokenId === selected) || null),
    [moths, selected]
  );

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div className="titles">
            <div className="kicker">LAMPWORKS • MIDNIGHT MOTHS</div>
            <h1>
              <span className="gold">LaempWorks</span> <span className="blue">Bridge</span>
            </h1>
            <p className="sub">Simple Sonic → Base bridging for your Midnight Moths. Scan, preview, approve, send.</p>
          </div>
        </div>

        <div className="pillrow">
          <div className="pill">
            <span className="dot" />
            <strong>Wallet</strong>
            <span className="mono">{shortWallet}</span>
          </div>
          <div className="pill">
            <span className="dot blueDot" />
            <strong>Network</strong>
            <span className="mono">
              {chainId === CHAINS.sonic.chainId
                ? 'Sonic (146)'
                : chainId === CHAINS.base.chainId
                ? 'Base (8453)'
                : chainId ?? '—'}
            </span>
          </div>

          {!wallet ? (
            <button className="btn primary" onClick={connect}>
              Connect
            </button>
          ) : (
            <div className="switchRow" style={{ display: 'flex', gap: 10 }}>
              <button className={`btn ${chainId === CHAINS.sonic.chainId ? 'primary' : ''}`} onClick={ensureSonic}>
                Switch to Sonic
              </button>
              <button className={`btn ${chainId === CHAINS.base.chainId ? 'primary' : ''}`} onClick={ensureBase}>
                Switch to Base
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <div className="cardHead">
            <h2>1) Find your Moths</h2>
            <div className="right">
              <button className="btn small" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide' : 'Show'} advanced
              </button>
            </div>
          </div>

          <p className="muted">Scan your wallet on Sonic (read-only). If scan misses something, add a tokenId manually.</p>

          <div className="row">
            <button
              className="btn primary"
              onClick={scanWallet}
              disabled={!wallet || txPhase === 'scanning' || txPhase === 'switching'}
            >
              {txPhase === 'scanning' ? 'Scanning…' : 'Scan wallet'}
            </button>

            <div className="manual">
              <input
                className="input"
                placeholder="Token ID (e.g. 33)"
                value={manualTokenId}
                onChange={(e) => setManualTokenId(e.target.value)}
              />
              <button className="btn" onClick={addManualToken} disabled={!wallet}>
                Add
              </button>
            </div>
          </div>

          {showAdvanced && (
            <div className="advanced">
              <div className="advRow">
                <div>
                  <span className="label">Sonic RPC</span>
                  <span className="mono">{CHAINS.sonic.rpcUrl}</span>
                </div>
              </div>
              <div className="advRow">
                <div>
                  <span className="label">Sonic NFT</span>
                  <span className="mono">{CONTRACTS.sonic.originalNft}</span>
                </div>
              </div>
              <div className="advRow">
                <div>
                  <span className="label">Sonic Adapter</span>
                  <span className="mono">{CONTRACTS.sonic.adapter}</span>
                </div>
              </div>
              <div className="advRow">
                <div>
                  <span className="label">Base Mirror NFT</span>
                  <span className="mono">{CONTRACTS.base.mirrorNft}</span>
                </div>
              </div>
              <div className="advRow">
                <div>
                  <span className="label">Destination EID</span>
                  <span className="mono">{String(CONTRACTS.layerzero.baseEid)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="divider" />

          <div className="list">
            {moths.length === 0 ? (
              <div className="empty">No moths loaded yet.</div>
            ) : (
              moths.map((m) => {
                const active = selected === m.tokenId;
                return (
                  <button
                    key={m.tokenId.toString()}
                    className={`item ${active ? 'active' : ''}`}
                    onClick={() => selectMoth(m.tokenId)}
                  >
                    <div className="thumb">
                      {m.image ? <img src={m.image} alt="" /> : <div className="thumbPh" />}
                    </div>
                    <div className="meta">
                      <div className="name">{m.name || `Midnight Moth #${m.tokenId.toString()}`}</div>
                      <div className="id mono">Token #{m.tokenId.toString()}</div>
                    </div>
                    <div className="chev">›</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="cardHead">
            <h2>2) Preview + Send</h2>
          </div>

          {selectedItem ? (
            <div className="preview">
              <div className="bigThumb">
                {selectedItem.image ? (
                  <img src={selectedItem.image} alt={selectedItem.name || ''} />
                ) : (
                  <div className="bigPh">No preview</div>
                )}
              </div>
              <div className="previewMeta">
                <div className="title">{selectedItem.name || `Midnight Moth #${selectedItem.tokenId.toString()}`}</div>
                <div className="mono smallMuted">Sonic → Base • Token #{selectedItem.tokenId.toString()}</div>

                <div className="actions">
                  <button
                    className="btn"
                    onClick={approveAdapter}
                    disabled={
                      !wallet || txPhase === 'approving' || txPhase === 'switching' || txPhase === 'scanning'
                    }
                  >
                    {txPhase === 'approving' ? 'Approving…' : 'Approve Adapter'}
                  </button>
                  <button
                    className="btn primary"
                    onClick={sendSelected}
                    disabled={
                      !wallet ||
                      txPhase === 'sending' ||
                      txPhase === 'quoting' ||
                      txPhase === 'approving' ||
                      txPhase === 'switching' ||
                      txPhase === 'scanning'
                    }
                  >
                    {txPhase === 'quoting' ? 'Quoting…' : txPhase === 'sending' ? 'Sending…' : 'Send to Base'}
                  </button>
                </div>

                {txHash && (
                  <div className="tx">
                    <span className="label">Tx</span>
                    <a className="mono" href={`${CHAINS.sonic.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
                      {txHash.slice(0, 10)}…{txHash.slice(-8)}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty big">Select a Moth to preview + send.</div>
          )}

          <div className="divider" />

          <div className={`status ${txPhase}`}>
            <strong>Status</strong>
            <p>{status}</p>
          </div>
        </div>
      </section>

      <footer className="foot">
        <span>© {new Date().getFullYear()} LampWorks • Midnight Moths</span>
      </footer>
    </main>
  );
}
