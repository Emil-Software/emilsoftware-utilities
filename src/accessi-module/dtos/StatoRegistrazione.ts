export enum StatoRegistrazione {
  NULL = 0,
  INSERT = 5,
  INVIO = 10,
  CONF = 20,
  DELETE = 50,
  BLOCC = 99,
}

export const StatoRegistrazioneValues = [0, 5, 10, 20, 50, 99] as const;
