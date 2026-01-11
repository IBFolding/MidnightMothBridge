'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, getAddress, isAddress, zeroPadValue } from 'ethers';
import { CHAINS, CONTRACTS, UI } from '@/src/lib/constants';
import { ERC721_ABI, ONFT_ADAPTER_ABI } from '@/src/lib/abi';

type TxPhase = 'idle' | 'switching' | 'scanning' | 'ready' | 'approving' | 'quoting' | 'sending' | 'success' | 'error';

type MothItem = {
  tokenId: bigint;
  tokenURI?: string;
  image?: string;
  name?: string;
};

const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function ipfsToHttp(uri: string) {
  if (!uri) return uri;
  if (uri.startsWith('ipfs://')) return UI.ipfsGateway + uri.replace('ipfs://', '');
  return uri;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function Page() {
  const [wallet, setWallet] = useState<string>('');
  const [chainId, setChainId] = useState<number | null>(null);

  const [manualTokenId, setManualTokenId] = useState<string>('');
  const [moths, setMoths] = useState<MothItem[]>([]);
  const [selected, setSelected] = useState<bigint | null>(null);

  const [txPhase, setTxPhase] = useState<TxPhase>('idle');
  const [status, setStatus] = useState<string>('Connect your wallet, then scan for your Midnight Moths.');
  const [txHash, setTxHash] = useState<string>('');

  const [showAdvanced, setShowAdvanced] = useState(false);

  const shortWallet = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Not connected';

  const sonicRpc = useMemo(() => new JsonRpcProvider(CHAINS.sonic.rpcUrl), []);
  const nftRead = useMemo(() => new Contract(CONTRACTS.sonic.originalNft, ERC721_ABI, sonicRpc), [sonicRpc]);
  const adapterRead = useMemo(() => new Contract(CONTRACTS.sonic.adapter, ONFT_ADAPTER_ABI, sonicRpc), [sonicRpc]);

  async function refreshChainFromWallet() {
    // @ts-ignore
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) return;
    const cidHex: string = await eth.request({ method: 'eth_chainId' });
    setChainId(parseInt(cidHex, 16));
  }

  useEffect(() => {
    refreshChainFromWallet();
    // @ts-ignore
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) return;
    const onChainChanged = () => refreshChainFromWallet();
    const onAccountsChanged = (accs: string[]) => setWallet(accs?.[0] ? getAddress(accs[0]) : '');
    eth.on?.('chainChanged', onChainChanged);
    eth.on?.('accountsChanged', onAccountsChanged);
    return () => {
      eth.removeListener?.('chainChanged', onChainChanged);
      eth.removeListener?.('accountsChanged', onAccountsChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    // @ts-ignore
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) {
      setTxPhase('error');
      setStatus('No injected wallet found. Install a wallet extension or use the Base app in-app wallet.');
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
    // @ts-ignore
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) throw new Error('No injected wallet');
    const cidHex: string = await eth.request({ method: 'eth_chainId' });
    const cid = parseInt(cidHex, 16);
    if (cid === CHAINS.sonic.chainId) return;

    setTxPhase('switching');
    setStatus('Switching wallet to Sonic…');

    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAINS.sonic.chainIdHex }],
      });
    } catch (err: any) {
      // If the chain hasn't been added to the wallet yet:
      if (err?.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: CHAINS.sonic.chainIdHex,
              chainName: 'Sonic',
              rpcUrls: CHAINS.sonic.walletRpcUrls,
              nativeCurrency: { name: 'S', symbol: 'S', decimals: 18 },
              blockExplorerUrls: [CHAINS.sonic.explorer],
            },
          ],
        });
      } else {
        throw err;
      }
    }

    await refreshChainFromWallet();
    setTxPhase('ready');
    setStatus('Wallet is on Sonic. You can scan now.');
  }

  const ensureBase = async () => {
    if (!hasEth) {
      setStatus('No injected wallet found. Please open in a wallet browser (Coinbase Wallet / MetaMask).');
      return;
    }
    const eth = window.ethereum;
    const cid = await getChainId(eth);
    if (cid === CHAINS.base.chainId) return;

    setTxPhase('switching');
    setStatus('Switching wallet to Base…');

    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAINS.base.chainIdHex }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: CHAINS.base.chainIdHex,
              chainName: 'Base',
              rpcUrls: CHAINS.base.walletRpcUrls,
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              blockExplorerUrls: [CHAINS.base.explorer],
            },
          ],
        });
      } else {
        throw err;
      }
    }

    await refreshChainFromWallet();
    setTxPhase('ready');
    setStatus('Wallet is on Base.');
  }

  async function loadPreview(tokenId: bigint) {
    try {
      const tokenURI: string = await nftRead.tokenURI(tokenId);
      const meta = await fetchJson(ipfsToHttp(tokenURI));
      const image = ipfsToHttp(meta?.image || meta?.image_url || '');
      const name = meta?.name || `Midnight Moth #${tokenId.toString()}`;
      setMoths((prev) =>
        prev.map((m) => (m.tokenId === tokenId ? { ...m, tokenURI, image, name } : m)),
      );
    } catch {
      // Preview is best-effort; don't block.
    }
  }

  async function scanWallet() {
    if (!wallet) {
      setTxPhase('error');
      setStatus('Connect your wallet first.');
      return;
    }

    try {
      await ensureSonic();
      setTxPhase('scanning');
      setStatus('Scanning your wallet for Midnight Moths on Sonic…');
      setTxHash('');

      // 1) Quick balance check (also validates that contract + RPC are correct)
      const bal: bigint = await nftRead.balanceOf(wallet);
      const balanceNum = Number(bal);
      if (!Number.isFinite(balanceNum) || balanceNum <= 0) {
        setMoths([]);
        setSelected(null);
        setTxPhase('ready');
        setStatus('No Moths detected on Sonic for this wallet.');
        return;
      }

      // 2) If contract supports ERC721Enumerable, use it (fast)
      const enumerableAbi = [
        { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ name: 'tokenId', type: 'uint256' }] },
      ] as const;

      const nftEnum = new Contract(CONTRACTS.sonic.originalNft, [...(ERC721_ABI as any), ...enumerableAbi] as any, sonicRpc);

      const found: bigint[] = [];

      try {
        const max = Math.min(balanceNum, 50); // safety cap for UI
        for (let i = 0; i < max; i++) {
          const id: bigint = await nftEnum.tokenOfOwnerByIndex(wallet, i);
          found.push(id);
        }
      } catch {
        // 3) Fallback: scan Transfer logs for last N blocks and reconstruct ownership
        const latest = await sonicRpc.getBlockNumber();
        const start = Math.max(0, latest - UI.scanBlocks);
        const chunk = UI.scanChunkSize;

        const ownerTopic = zeroPadValue(wallet, 32).toLowerCase();

        const tokenSet = new Set<string>();

        // Scan incoming and outgoing logs in the same loop
        for (let from = start; from <= latest; from += chunk) {
          const to = Math.min(latest, from + chunk - 1);

          const [inLogs, outLogs] = await Promise.all([
            sonicRpc.getLogs({
              address: CONTRACTS.sonic.originalNft,
              fromBlock: from,
              toBlock: to,
              topics: [TRANSFER_SIG, null, ownerTopic],
            }),
            sonicRpc.getLogs({
              address: CONTRACTS.sonic.originalNft,
              fromBlock: from,
              toBlock: to,
              topics: [TRANSFER_SIG, ownerTopic, null],
            }),
          ]);

          // ethers v6 Log type uses `index` (not `logIndex`). Some RPCs may still return `logIndex`.
          const getIdx = (l: any) => (typeof l.index === 'number' ? l.index : typeof l.logIndex === 'number' ? l.logIndex : 0);
          const logs = [...inLogs, ...outLogs].sort((a: any, b: any) => (a.blockNumber - b.blockNumber) || (getIdx(a) - getIdx(b)));


          for (const log of logs) {
            const fromAddr = ('0x' + log.topics[1].slice(26)).toLowerCase();
            const toAddr = ('0x' + log.topics[2].slice(26)).toLowerCase();
            const tokenId = BigInt(log.topics[3]);

            if (toAddr === wallet.toLowerCase()) tokenSet.add(tokenId.toString());
            if (fromAddr === wallet.toLowerCase()) tokenSet.delete(tokenId.toString());
          }
        }

        tokenSet.forEach((s) => found.push(BigInt(s)));
      }

      found.sort((a, b) => (a < b ? -1 : 1));
      const items: MothItem[] = found.map((id) => ({ tokenId: id }));

      setMoths(items);
      setSelected(items[0]?.tokenId ?? null);

      // Load previews for first ~12 for speed
      await Promise.all(items.slice(0, 12).map((m) => loadPreview(m.tokenId)));

      setTxPhase('ready');
      setStatus(`Found ${items.length} Moth(s). Select one, approve (once), then send.`);
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Scan failed: ${e?.message ?? String(e)}`);
    }
  }

  async function addManualToken() {
    if (!wallet) {
      setTxPhase('error');
      setStatus('Connect your wallet first.');
      return;
    }

    const raw = manualTokenId.trim();
    if (!raw) return;

    let tokenId: bigint;
    try {
      tokenId = BigInt(raw);
    } catch {
      setTxPhase('error');
      setStatus('Token ID must be a number.');
      return;
    }

    try {
      await ensureSonic();
      setTxPhase('scanning');
      setStatus(`Checking ownership of token #${tokenId.toString()}…`);

      const owner: string = await nftRead.ownerOf(tokenId);
      if (owner.toLowerCase() !== wallet.toLowerCase()) {
        setTxPhase('error');
        setStatus(`That token is not owned by this wallet on Sonic. ownerOf() = ${owner}`);
        return;
      }

      setMoths((prev) => {
        const exists = prev.some((m) => m.tokenId === tokenId);
        if (exists) return prev;
        return [{ tokenId }, ...prev];
      });
      setSelected(tokenId);
      await loadPreview(tokenId);

      setTxPhase('ready');
      setStatus(`Added token #${tokenId.toString()}. You can approve + send.`);
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Could not verify token on Sonic: ${e?.message ?? String(e)}`);
    }
  }

  async function approveAdapter() {
    if (!wallet) return;
    try {
      await ensureSonic();
      setTxPhase('approving');
      setStatus('Approving the Adapter to move your Moths (one-time)…');
      setTxHash('');

      // @ts-ignore
      const eth = window.ethereum;
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();

      const nftWrite = new Contract(CONTRACTS.sonic.originalNft, ERC721_ABI, signer);
      const tx = await nftWrite.setApprovalForAll(CONTRACTS.sonic.adapter, true);
      setTxHash(tx.hash);
      await tx.wait();

      setTxPhase('ready');
      setStatus('Approved. Now select a Moth and send it to Base.');
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Approve failed: ${e?.message ?? String(e)}`);
    }
  }

  async function sendSelected() {
    if (!wallet) return;
    if (selected == null) {
      setTxPhase('error');
      setStatus('Select a Moth first.');
      return;
    }

    try {
      await ensureSonic();
      setTxPhase('quoting');
      setStatus('Quoting LayerZero fee…');
      setTxHash('');

      const toBytes32 = zeroPadValue(wallet, 32);
      const sendParam = {
        dstEid: CONTRACTS.layerzero.baseEid,
        to: toBytes32,
        tokenId: selected,
        extraOptions: '0x',
        composeMsg: '0x',
        onftCmd: '0x',
      };

      // quoteSend returns (MessagingFee fee, MessagingReceipt receipt?) depending on contract;
      // our adapter ABI returns MessagingFee with nativeFee.
      const fee = await adapterRead.quoteSend(sendParam, false);
      const nativeFee: bigint = fee?.nativeFee ?? fee?.[0] ?? 0n;

      setTxPhase('sending');
      setStatus(`Sending Moth #${selected.toString()}…`);
      // @ts-ignore
      const eth = window.ethereum;
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const adapterWrite = new Contract(CONTRACTS.sonic.adapter, ONFT_ADAPTER_ABI, signer);

      const tx = await adapterWrite.sendFrom(wallet, sendParam, { value: nativeFee });
      setTxHash(tx.hash);
      await tx.wait();

      setTxPhase('success');
      setStatus(`Sent! Moth #${selected.toString()} is on the way to Base. (It may take a moment to finalize.)`);
    } catch (e: any) {
      setTxPhase('error');
      setStatus(`Send failed: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  const selectedItem = useMemo(() => (selected == null ? null : moths.find((m) => m.tokenId === selected) || null), [moths, selected]);

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
              {chainId === CHAINS.sonic.chainId ? 'Sonic (146)' : chainId === CHAINS.base.chainId ? 'Base (8453)' : (chainId ?? '—')}
            </span>
          </div>

          {!wallet ? (
            <button className="btn primary" onClick={connect}>Connect</button>
          ) : (
            <div className="switchRow">
              <button
                className={`btn ${chainId === CHAINS.sonic.chainId ? 'primary' : ''}`}
                onClick={ensureSonic}
              >
                Switch to Sonic
              </button>
              <button
                className={`btn ${chainId === CHAINS.base.chainId ? 'primary' : ''}`}
                onClick={ensureBase}
              >
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

          <p className="muted">Scan your wallet on Sonic. If scan misses something, add a tokenId manually.</p>

          <div className="row">
            <button className="btn primary" onClick={scanWallet} disabled={!wallet || txPhase === 'scanning' || txPhase === 'switching'}>
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
                <div><span className="label">Sonic NFT</span><span className="mono">{CONTRACTS.sonic.originalNft}</span></div>
              </div>
              <div className="advRow">
                <div><span className="label">Sonic Adapter</span><span className="mono">{CONTRACTS.sonic.adapter}</span></div>
              </div>
              <div className="advRow">
                <div><span className="label">Base Mirror NFT</span><span className="mono">{CONTRACTS.base.mirrorNft}</span></div>
              </div>
              <div className="advRow">
                <div><span className="label">Destination EID</span><span className="mono">{String(CONTRACTS.layerzero.baseEid)}</span></div>
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
                  <button key={m.tokenId.toString()} className={`item ${active ? 'active' : ''}`} onClick={() => { setSelected(m.tokenId); loadPreview(m.tokenId); }}>
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
                {selectedItem.image ? <img src={selectedItem.image} alt={selectedItem.name || ''} /> : <div className="bigPh">No preview yet</div>}
              </div>
              <div className="previewMeta">
                <div className="title">{selectedItem.name || `Midnight Moth #${selectedItem.tokenId.toString()}`}</div>
                <div className="mono smallMuted">Sonic → Base • Token #{selectedItem.tokenId.toString()}</div>

                <div className="actions">
                  <button className="btn" onClick={approveAdapter} disabled={!wallet || txPhase === 'approving' || txPhase === 'switching' || txPhase === 'scanning'}>
                    {txPhase === 'approving' ? 'Approving…' : 'Approve Adapter'}
                  </button>
                  <button className="btn primary" onClick={sendSelected} disabled={!wallet || txPhase === 'sending' || txPhase === 'quoting' || txPhase === 'approving' || txPhase === 'switching' || txPhase === 'scanning'}>
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