export const CHAINS = {
  sonic: {
    name: 'Sonic',
    chainId: 146, // decimal
    chainIdHex: '0x92',
    // Many public RPCs block browser CORS. Default to our same-origin proxy.
    // Override with NEXT_PUBLIC_SONIC_RPC if you have a CORS-enabled endpoint.
    rpcUrl: process.env.NEXT_PUBLIC_SONIC_RPC || '/api/rpc/sonic',
    explorer: 'https://sonicscan.org',
    // For wallet_addEthereumChain we must provide absolute RPC URLs (not our proxy).
    walletRpcUrls: ['https://rpc.soniclabs.com'],
  },
  base: {
    name: 'Base',
    chainId: 8453,
    chainIdHex: '0x2105',
    // Many public RPCs block browser CORS. Default to our same-origin proxy.
    // Override with NEXT_PUBLIC_BASE_RPC if you have a CORS-enabled endpoint.
    rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC || '/api/rpc/base',
    explorer: 'https://basescan.org',
    walletRpcUrls: ['https://mainnet.base.org'],
  },
} as const;

export const CONTRACTS = {
  // Midnight Moths:
  // - Original ERC721 on Sonic
  // - LayerZero ONFT Adapter (lockbox) on Sonic
  // - Mirror ONFT ERC721 on Base (already deployed)
  sonic: {
    originalNft: '0xd0b90C78F27A5773de511B94DF36552AAaEe2b76',
    adapter: '0xCe4506cd5467Cec86A0093D4C08b53f56F73815F',
  },
  base: {
    mirrorNft: '0x48c743fd1ca4D3A56494D7430022C06Abb843ECe',
  },
  layerzero: {
    // Base destination EID (LayerZero v2)
    baseEid: 30184,
  },
} as const;

export const UI = {
  // scanning Transfer logs is expensive; keep it reasonable
  scanBlocks: 250_000,
  scanChunkSize: 5_000,
  ipfsGateway: 'https://ipfs.io/ipfs/',
} as const;
