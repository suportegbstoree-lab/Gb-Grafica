import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type TokenOptions,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'demo-gb-grafica-rules';
const MAX_ARTWORK_BYTES = 15 * 1024 * 1024;
const MAX_CATALOG_IMAGE_BYTES = 8 * 1024 * 1024;

let testEnvironment: RulesTestEnvironment | undefined;

function environment(): RulesTestEnvironment {
  assert.ok(testEnvironment, 'O ambiente de testes do Firebase não foi inicializado.');
  return testEnvironment;
}

function authenticatedContext(uid: string, token: TokenOptions = {}) {
  return environment().authenticatedContext(uid, {
    email: `${uid}@example.com`,
    email_verified: true,
    ...token,
  });
}

async function seedDocuments(
  entries: Array<[path: string, data: Record<string, unknown>]>,
): Promise<void> {
  await environment().withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    for (const [documentPath, data] of entries) {
      await firestore.doc(documentPath).set(data);
    }
  });
}

async function seedStorageObject(
  objectPath: string,
  ownerId: string,
  contentType = 'application/pdf',
): Promise<void> {
  await environment().withSecurityRulesDisabled(async (context) => {
    await context.storage().ref(objectPath).put(new Uint8Array([1, 2, 3]), {
      contentType,
      customMetadata: { ownerId },
    });
  });
}

function artworkMetadata(ownerId: string, contentType: string) {
  return {
    contentType,
    customMetadata: {
      ownerId,
      originalName: 'arte-do-cliente.pdf',
    },
  };
}

function catalogImageMetadata(uploadedBy: string, contentType: string) {
  return {
    contentType,
    customMetadata: {
      uploadedBy,
      originalName: 'imagem-produto.png',
    },
  };
}

function assertUploadSucceeds<T>(upload: PromiseLike<T>): Promise<T> {
  return assertSucceeds(Promise.resolve(upload));
}

function assertUploadFails(upload: PromiseLike<unknown>): Promise<unknown> {
  return assertFails(Promise.resolve(upload));
}

function validProduct(overrides: Record<string, unknown> = {}) {
  return {
    nome: 'Carimbo',
    desc: 'Carimbo personalizado',
    categoria: 'Carimbos',
    imagem: 'https://example.com/carimbo.jpg',
    tipoInput: 'arte',
    ...overrides,
  };
}

function validOrder(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    data: '2026-09-17T12:00:00.000Z',
    total: '8,40',
    status: 'Pendente',
    itens: [],
    ...overrides,
  };
}

before(async () => {
  const [firestoreRules, storageRules] = await Promise.all([
    readFile(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    readFile(path.resolve(process.cwd(), 'storage.rules'), 'utf8'),
  ]);

  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: firestoreRules },
    storage: { rules: storageRules },
  });
});

beforeEach(async () => {
  await environment().clearFirestore();
});

after(async () => {
  await testEnvironment?.cleanup();
});

test('Firestore: catálogo e configuração são públicos somente para leitura', async () => {
  await seedDocuments([
    ['anuncios/produto-1', validProduct()],
    ['categories/carimbos', { nome: 'Carimbos' }],
    ['promocoes/promocao-1', { titulo: 'Oferta', imagem: 'https://example.com/oferta.jpg', ativa: true }],
    ['config/main', { telefone1: '(16) 99999-9999' }],
  ]);

  const firestore = environment().unauthenticatedContext().firestore();
  await assertSucceeds(firestore.doc('anuncios/produto-1').get());
  await assertSucceeds(firestore.collection('categories').get());
  await assertSucceeds(firestore.doc('promocoes/promocao-1').get());
  await assertSucceeds(firestore.doc('config/main').get());
  await assertFails(firestore.doc('config/main').set({ telefone1: 'alterado' }));
});

test('Firestore: usuário comum não altera catálogo nem configuração', async () => {
  await seedDocuments([
    ['anuncios/produto-1', validProduct()],
    ['categories/carimbos', { nome: 'Carimbos' }],
  ]);

  const firestore = authenticatedContext('alice').firestore();
  await assertFails(firestore.doc('anuncios/produto-2').set(validProduct()));
  await assertFails(firestore.doc('anuncios/produto-1').update({ desc: 'Alterada' }));
  await assertFails(firestore.doc('categories/carimbos').delete());
  await assertFails(firestore.doc('config/main').set({ telefone1: '(16) 98888-8888' }));
});

test('Firestore: custom claim administrativa gerencia documentos válidos do catálogo', async () => {
  const firestore = authenticatedContext('admin-claim', { admin: true }).firestore();

  await assertSucceeds(firestore.doc('anuncios/produto-1').set(validProduct()));
  await assertSucceeds(firestore.doc('anuncios/produto-1').update({ desc: 'Descrição atualizada' }));
  await assertSucceeds(firestore.doc('categories/carimbos').set({ nome: 'Carimbos' }));
  await assertSucceeds(firestore.doc('promocoes/promocao-1').set({
    titulo: 'Oferta',
    imagem: 'https://example.com/oferta.jpg',
    ativa: true,
  }));
  await assertSucceeds(firestore.doc('config/main').set({ telefone1: '(16) 99999-9999' }));
  await assertSucceeds(firestore.doc('anuncios/produto-1').delete());
});

test('Firestore: perfil legado com role admin mantém o acesso administrativo', async () => {
  await seedDocuments([
    ['users/admin-role', { uid: 'admin-role', email: 'admin-role@example.com', role: 'admin' }],
  ]);

  const firestore = authenticatedContext('admin-role').firestore();
  await assertSucceeds(firestore.doc('categories/cadernos').set({ nome: 'Cadernos' }));
});

test('Firestore: administrador não grava documentos de catálogo inválidos', async () => {
  const firestore = authenticatedContext('admin-claim', { admin: true }).firestore();

  await assertFails(firestore.doc('anuncios/invalido').set({ nome: 'Sem campos obrigatórios' }));
  await assertFails(firestore.doc('categories/invalida').set({ nome: '' }));
  await assertFails(firestore.doc('promocoes/invalida').set({
    titulo: '',
    imagem: 'https://example.com/oferta.jpg',
    ativa: true,
  }));
});

test('Firestore: pedido só pode ser lido pelo proprietário ou por administrador', async () => {
  await seedDocuments([
    ['orders/pedido-alice', validOrder('alice')],
    ['users/admin-role', { uid: 'admin-role', email: 'admin-role@example.com', role: 'admin' }],
  ]);

  await assertSucceeds(authenticatedContext('alice').firestore().doc('orders/pedido-alice').get());
  await assertFails(authenticatedContext('bob').firestore().doc('orders/pedido-alice').get());
  await assertFails(environment().unauthenticatedContext().firestore().doc('orders/pedido-alice').get());
  await assertSucceeds(
    authenticatedContext('admin-claim', { admin: true }).firestore().doc('orders/pedido-alice').get(),
  );
  await assertSucceeds(authenticatedContext('admin-role').firestore().doc('orders/pedido-alice').get());
});

test('Firestore: consulta de pedidos exige filtro do proprietário para usuário comum', async () => {
  await seedDocuments([
    ['orders/pedido-alice', validOrder('alice')],
    ['orders/pedido-bob', validOrder('bob')],
  ]);

  const alice = authenticatedContext('alice').firestore();
  const ownedOrders = await assertSucceeds(
    alice.collection('orders').where('userId', '==', 'alice').get(),
  );
  assert.equal(ownedOrders.size, 1);
  await assertFails(alice.collection('orders').get());

  const admin = authenticatedContext('admin-claim', { admin: true }).firestore();
  const allOrders = await assertSucceeds(admin.collection('orders').get());
  assert.equal(allOrders.size, 2);
});

test('Firestore: nenhum cliente altera pedidos diretamente, inclusive administrador', async () => {
  await seedDocuments([['orders/pedido-alice', validOrder('alice')]]);

  const alice = authenticatedContext('alice').firestore();
  const admin = authenticatedContext('admin-claim', { admin: true }).firestore();
  await assertFails(alice.doc('orders/novo-pedido').set(validOrder('alice')));
  await assertFails(admin.doc('orders/novo-pedido-admin').set(validOrder('alice')));
  await assertFails(alice.doc('orders/pedido-alice').update({ status: 'Pago' }));
  await assertFails(admin.doc('orders/pedido-alice').update({ status: 'Pago' }));
  await assertFails(admin.doc('orders/pedido-alice').delete());
});

test('Firestore: subcoleções de pedidos permanecem exclusivas do servidor', async () => {
  await seedDocuments([
    ['orders/pedido-alice', validOrder('alice')],
    ['orders/pedido-alice/events/evento-1', { status: 'Pago' }],
  ]);

  const alice = authenticatedContext('alice').firestore();
  const admin = authenticatedContext('admin-claim', { admin: true }).firestore();
  await assertFails(alice.doc('orders/pedido-alice/events/evento-1').get());
  await assertFails(admin.doc('orders/pedido-alice/events/evento-1').get());
  await assertFails(alice.doc('orders/pedido-alice/events/evento-2').set({ status: 'Enviado' }));
  await assertFails(admin.doc('orders/pedido-alice/events/evento-2').set({ status: 'Enviado' }));
});

test('Firestore: usuário cria somente o próprio perfil básico', async () => {
  const alice = authenticatedContext('alice', { email: 'alice@gb.test' }).firestore();

  await assertSucceeds(alice.doc('users/alice').set({
    uid: 'alice',
    email: 'alice@gb.test',
    role: 'user',
  }));
  await assertFails(alice.doc('users/bob').set({
    uid: 'bob',
    email: 'alice@gb.test',
    role: 'user',
  }));
});

test('Firestore: usuário não pode se promover nem falsificar UID ou e-mail', async () => {
  const alice = authenticatedContext('alice', { email: 'alice@gb.test' }).firestore();

  await assertFails(alice.doc('users/alice').set({ uid: 'alice', email: 'alice@gb.test', role: 'admin' }));
  await assertFails(alice.doc('users/alice').set({ uid: 'bob', email: 'alice@gb.test', role: 'user' }));
  await assertFails(alice.doc('users/alice').set({ uid: 'alice', email: 'outra@gb.test', role: 'user' }));
});

test('Firestore: atualização do próprio perfil preserva campos de identidade e função', async () => {
  await seedDocuments([
    ['users/alice', { uid: 'alice', email: 'alice@gb.test', role: 'user', nome: 'Alice' }],
  ]);

  const alice = authenticatedContext('alice', { email: 'alice@gb.test' }).firestore();
  await assertSucceeds(alice.doc('users/alice').update({ nome: 'Alice Silva' }));
  await assertFails(alice.doc('users/alice').update({ uid: 'bob' }));
  await assertFails(alice.doc('users/alice').update({ email: 'outra@gb.test' }));
  await assertFails(alice.doc('users/alice').update({ role: 'admin' }));
});

test('Firestore: perfis alheios são privados e somente administrador pode gerenciá-los', async () => {
  await seedDocuments([
    ['users/bob', { uid: 'bob', email: 'bob@gb.test', role: 'user', nome: 'Bob' }],
  ]);

  const alice = authenticatedContext('alice').firestore();
  const admin = authenticatedContext('admin-claim', { admin: true }).firestore();
  await assertFails(alice.doc('users/bob').get());
  await assertFails(alice.doc('users/bob').update({ nome: 'Invadido' }));
  await assertFails(alice.doc('users/bob').delete());
  await assertSucceeds(admin.doc('users/bob').get());
  await assertSucceeds(admin.doc('users/bob').update({ role: 'admin' }));
  await assertSucceeds(admin.doc('users/bob').delete());
});

test('Firestore: coleções técnicas e caminhos desconhecidos são inacessíveis ao cliente', async () => {
  const admin = authenticatedContext('admin-claim', { admin: true }).firestore();
  const alice = authenticatedContext('alice').firestore();

  for (const documentPath of [
    '_rateLimits/alice',
    '_checkoutRequests/tentativa-1',
    '_pagbankHomologation/captura-1',
    'internal/secreto',
  ]) {
    await assertFails(admin.doc(documentPath).get());
    await assertFails(alice.doc(documentPath).set({ valor: 'proibido' }));
  }
});

test('Storage: usuário anônimo não envia, lê ou remove arte pendente', async () => {
  const objectPath = `artworks/alice/pending/${'a'.repeat(32)}.pdf`;
  const storageReference = environment().unauthenticatedContext().storage().ref(objectPath);

  await assertUploadFails(storageReference.put(
    new Uint8Array([1]),
    artworkMetadata('alice', 'application/pdf'),
  ));
  await seedStorageObject(objectPath, 'alice');
  await assertFails(storageReference.getMetadata());
  await assertFails(storageReference.delete());
});

test('Storage: proprietário envia, lê e remove a própria arte pendente', async () => {
  const objectPath = `artworks/alice/pending/${'b'.repeat(32)}.pdf`;
  const storageReference = authenticatedContext('alice').storage().ref(objectPath);

  await assertUploadSucceeds(storageReference.put(
    new Uint8Array([1, 2, 3]),
    artworkMetadata('alice', 'application/pdf'),
  ));
  const metadata = await assertSucceeds(storageReference.getMetadata());
  assert.equal(metadata.customMetadata?.ownerId, 'alice');
  await assertSucceeds(storageReference.delete());
});

test('Storage: um usuário não acessa a pasta pendente de outro', async () => {
  const objectPath = `artworks/alice/pending/${'c'.repeat(32)}.png`;
  const aliceReference = authenticatedContext('alice').storage().ref(objectPath);
  const bobReference = authenticatedContext('bob').storage().ref(objectPath);

  await assertUploadFails(bobReference.put(
    new Uint8Array([1]),
    artworkMetadata('bob', 'image/png'),
  ));
  await assertUploadSucceeds(aliceReference.put(
    new Uint8Array([1]),
    artworkMetadata('alice', 'image/png'),
  ));
  await assertFails(bobReference.getMetadata());
  await assertFails(bobReference.delete());
  await assertSucceeds(aliceReference.delete());
});

test('Storage: upload exige ownerId correspondente ao usuário autenticado', async () => {
  const aliceStorage = authenticatedContext('alice').storage();
  const missingOwnerPath = `artworks/alice/pending/${'d'.repeat(32)}.pdf`;
  const wrongOwnerPath = `artworks/alice/pending/${'e'.repeat(32)}.pdf`;

  await assertUploadFails(aliceStorage.ref(missingOwnerPath).put(new Uint8Array([1]), {
    contentType: 'application/pdf',
  }));
  await assertUploadFails(aliceStorage.ref(wrongOwnerPath).put(
    new Uint8Array([1]),
    artworkMetadata('bob', 'application/pdf'),
  ));
});

test('Storage: upload rejeita arquivo vazio, tipo proibido e limite excedido', async () => {
  const storage = authenticatedContext('alice').storage();

  await assertUploadFails(storage.ref(`artworks/alice/pending/${'f'.repeat(32)}.pdf`).put(
    new Uint8Array(),
    artworkMetadata('alice', 'application/pdf'),
  ));
  await assertUploadFails(storage.ref(`artworks/alice/pending/${'1'.repeat(32)}.exe`).put(
    new Uint8Array([1]),
    artworkMetadata('alice', 'application/octet-stream'),
  ));
  await assertUploadFails(storage.ref(`artworks/alice/pending/${'2'.repeat(32)}.pdf`).put(
    new Uint8Array(MAX_ARTWORK_BYTES + 1),
    artworkMetadata('alice', 'application/pdf'),
  ));
});

test('Storage: limite exato de 15 MB continua permitido', async () => {
  const objectPath = `artworks/alice/pending/${'3'.repeat(32)}.pdf`;
  const storageReference = authenticatedContext('alice').storage().ref(objectPath);

  await assertUploadSucceeds(storageReference.put(
    new Uint8Array(MAX_ARTWORK_BYTES),
    artworkMetadata('alice', 'application/pdf'),
  ));
  await assertSucceeds(storageReference.delete());
});

test('Storage: nome gerado e extensão precisam corresponder ao MIME', async () => {
  const storage = authenticatedContext('alice').storage();

  await assertUploadFails(storage.ref('artworks/alice/pending/arquivo-do-cliente.pdf').put(
    new Uint8Array([1]),
    artworkMetadata('alice', 'application/pdf'),
  ));
  await assertUploadFails(storage.ref(`artworks/alice/pending/${'4'.repeat(32)}.jpg`).put(
    new Uint8Array([1]),
    artworkMetadata('alice', 'application/pdf'),
  ));
});

test('Storage: PDF, JPG, PNG e WebP válidos permanecem aceitos', async () => {
  const storage = authenticatedContext('alice').storage();
  const formats = [
    ['5', 'pdf', 'application/pdf'],
    ['6', 'jpg', 'image/jpeg'],
    ['7', 'png', 'image/png'],
    ['8', 'webp', 'image/webp'],
  ] as const;

  for (const [character, extension, contentType] of formats) {
    const reference = storage.ref(
      `artworks/alice/pending/${character.repeat(32)}.${extension}`,
    );
    await assertUploadSucceeds(reference.put(
      new Uint8Array([1]),
      artworkMetadata('alice', contentType),
    ));
    await assertSucceeds(reference.delete());
  }
});

test('Storage: arquivo pendente existente não pode ser sobrescrito', async () => {
  const objectPath = `artworks/alice/pending/${'9'.repeat(32)}.pdf`;
  const storageReference = authenticatedContext('alice').storage().ref(objectPath);

  await assertUploadSucceeds(storageReference.put(
    new Uint8Array([1]),
    artworkMetadata('alice', 'application/pdf'),
  ));
  await assertUploadFails(storageReference.put(
    new Uint8Array([2]),
    artworkMetadata('alice', 'application/pdf'),
  ));
  await assertSucceeds(storageReference.delete());
});

test('Storage: arte vinculada ao pedido é somente leitura para o proprietário', async () => {
  const objectPath = `artworks/alice/orders/GB-TESTE/item-1/${'a1'.repeat(16)}.pdf`;
  await seedStorageObject(objectPath, 'alice');

  const aliceReference = authenticatedContext('alice').storage().ref(objectPath);
  const bobReference = authenticatedContext('bob').storage().ref(objectPath);
  const adminReference = authenticatedContext('admin-claim', { admin: true }).storage().ref(objectPath);

  await assertSucceeds(aliceReference.getMetadata());
  await assertFails(bobReference.getMetadata());
  await assertFails(adminReference.getMetadata());
  await assertUploadFails(aliceReference.put(
    new Uint8Array([2]),
    artworkMetadata('alice', 'application/pdf'),
  ));
  await assertFails(aliceReference.delete());
});

test('Storage: imagem do catálogo é pública somente para leitura individual', async () => {
  const objectPath = `catalog/products/produto-1/${'b1'.repeat(16)}.png`;
  await environment().withSecurityRulesDisabled(async (context) => {
    await context.storage().ref(objectPath).put(new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
      customMetadata: { uploadedBy: 'admin-claim' },
    });
  });

  const publicReference = environment().unauthenticatedContext().storage().ref(objectPath);
  await assertSucceeds(publicReference.getMetadata());
  await assertFails(publicReference.delete());
  await assertFails(environment().unauthenticatedContext().storage().ref('catalog/products/produto-1').listAll());
});

test('Storage: somente claim administrativa envia e remove imagens válidas do catálogo', async () => {
  const objectPath = `catalog/products/produto-1/${'c1'.repeat(16)}.webp`;
  const adminReference = authenticatedContext('admin-claim', { admin: true }).storage().ref(objectPath);
  const userReference = authenticatedContext('alice').storage().ref(objectPath);

  await assertUploadFails(userReference.put(
    new Uint8Array([1]),
    catalogImageMetadata('alice', 'image/webp'),
  ));
  await assertUploadSucceeds(adminReference.put(
    new Uint8Array([1, 2, 3]),
    catalogImageMetadata('admin-claim', 'image/webp'),
  ));
  await assertFails(userReference.delete());
  await assertSucceeds(adminReference.delete());
});

test('Storage: imagem de catálogo valida tamanho, MIME, nome e metadados', async () => {
  const storage = authenticatedContext('admin-claim', { admin: true }).storage();

  await assertUploadFails(storage.ref(`catalog/products/produto-1/${'d1'.repeat(16)}.svg`).put(
    new Uint8Array([1]),
    catalogImageMetadata('admin-claim', 'image/svg+xml'),
  ));
  await assertUploadFails(storage.ref(`catalog/products/produto-1/${'d2'.repeat(16)}.jpg`).put(
    new Uint8Array([1]),
    catalogImageMetadata('admin-claim', 'image/png'),
  ));
  await assertUploadFails(storage.ref('catalog/products/produto-1/capa.png').put(
    new Uint8Array([1]),
    catalogImageMetadata('admin-claim', 'image/png'),
  ));
  await assertUploadFails(storage.ref(`catalog/products/produto-1/${'d3'.repeat(16)}.png`).put(
    new Uint8Array(MAX_CATALOG_IMAGE_BYTES + 1),
    catalogImageMetadata('admin-claim', 'image/png'),
  ));
  await assertUploadFails(storage.ref(`catalog/products/produto-1/${'d4'.repeat(16)}.png`).put(
    new Uint8Array([1]),
    catalogImageMetadata('outra-pessoa', 'image/png'),
  ));
});

test('Storage: imagem existente do catálogo não pode ser sobrescrita', async () => {
  const objectPath = `catalog/products/produto-1/${'e1'.repeat(16)}.jpg`;
  const reference = authenticatedContext('admin-claim', { admin: true }).storage().ref(objectPath);

  await assertUploadSucceeds(reference.put(
    new Uint8Array([1]),
    catalogImageMetadata('admin-claim', 'image/jpeg'),
  ));
  await assertUploadFails(reference.put(
    new Uint8Array([2]),
    catalogImageMetadata('admin-claim', 'image/jpeg'),
  ));
  await assertSucceeds(reference.delete());
});

test('Storage: caminhos fora das áreas autorizadas são bloqueados', async () => {
  const objectPath = 'catalogo-interno/banner.png';
  await seedStorageObject(objectPath, 'alice', 'image/png');

  const reference = authenticatedContext('alice').storage().ref(objectPath);
  await assertFails(reference.getMetadata());
  await assertUploadFails(reference.put(
    new Uint8Array([1]),
    artworkMetadata('alice', 'image/png'),
  ));
  await assertFails(reference.delete());
});
