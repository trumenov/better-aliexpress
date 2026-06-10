<?php
declare(strict_types=1);

// Basic Auth → user_name
$userName = '';
if (!empty($_SERVER['PHP_AUTH_USER'])) {
    $userName = mb_substr($_SERVER['PHP_AUTH_USER'], 0, 64);
} elseif (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $parts = explode(':', base64_decode(substr($_SERVER['HTTP_AUTHORIZATION'], 6)), 2);
    $userName = mb_substr($parts[0] ?? '', 0, 64);
} elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $parts = explode(':', base64_decode(substr($_SERVER['REDIRECT_HTTP_AUTHORIZATION'], 6)), 2);
    $userName = mb_substr($parts[0] ?? '', 0, 64);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Only POST allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data || !isset($data['productId'], $data['vendorId'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required fields: productId, vendorId']);
    exit;
}

$dbPath = __DIR__ . '/../storage/db.sqlite';
$dbDir = dirname($dbPath);
if (!is_dir($dbDir)) {
    mkdir($dbDir, 0755, true);
}

try {
    $db = new SQLite3($dbPath);
    $db->enableExceptions(true);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('PRAGMA foreign_keys=ON');

    $db->exec('
        CREATE TABLE IF NOT EXISTS vendors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            data_json_hash TEXT
        )
    ');
    $db->exec('
        CREATE TABLE IF NOT EXISTS products (
            id TEXT NOT NULL,
            vendor_id TEXT NOT NULL,
            message TEXT,
            options_json_hash TEXT,
            PRIMARY KEY (id, vendor_id),
            FOREIGN KEY (vendor_id) REFERENCES vendors(id)
        )
    ');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id)');
    $db->exec('
        CREATE TABLE IF NOT EXISTS product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT NOT NULL,
            product_id TEXT NOT NULL,
            vendor_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            variant_name TEXT NOT NULL,
            price_usd REAL NOT NULL,
            shipping_usd REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%S\', \'now\'))
        )
    ');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id, vendor_id)');

    $vendorId = $data['vendorId'];
    $vendorName = $data['vendorName'] ?? '';
    $vendorHash = md5(json_encode(['name' => $vendorName]));

    $stmt = $db->prepare('INSERT OR IGNORE INTO vendors (id, name, data_json_hash) VALUES (:id, :name, :hash)');
    $stmt->bindValue(':id', $vendorId, SQLITE3_TEXT);
    $stmt->bindValue(':name', $vendorName, SQLITE3_TEXT);
    $stmt->bindValue(':hash', $vendorHash, SQLITE3_TEXT);
    $stmt->execute();

    $stmt = $db->prepare('UPDATE vendors SET name = :name, data_json_hash = :hash WHERE id = :id');
    $stmt->bindValue(':id', $vendorId, SQLITE3_TEXT);
    $stmt->bindValue(':name', $vendorName, SQLITE3_TEXT);
    $stmt->bindValue(':hash', $vendorHash, SQLITE3_TEXT);
    $stmt->execute();

    $productId = $data['productId'];
    $optionsHash = '';
    if (isset($data['variants']) && is_array($data['variants'])) {
        $optionsHash = md5(json_encode($data['variants']));
    }

    $stmt = $db->prepare('INSERT OR REPLACE INTO products (id, vendor_id, message, options_json_hash) VALUES (:pid, :vid, :msg, :hash)');
    $stmt->bindValue(':pid', $productId, SQLITE3_TEXT);
    $stmt->bindValue(':vid', $vendorId, SQLITE3_TEXT);
    $stmt->bindValue(':msg', $data['message'] ?? null, SQLITE3_TEXT);
    $stmt->bindValue(':hash', $optionsHash, SQLITE3_TEXT);
    $stmt->execute();

    $productName = mb_substr($data['productName'] ?? '', 0, 255);
    $shippingUsd = (float)($data['shippingCost'] ?? 0);

    $insertVariant = $db->prepare('
        INSERT INTO product_variants (user_name, product_id, vendor_id, product_name, variant_name, price_usd, shipping_usd)
        VALUES (:user, :pid, :vid, :pname, :vname, :price, :shipping)
    ');
    $insertVariant->bindValue(':user', $userName, SQLITE3_TEXT);
    $insertVariant->bindValue(':pid', $productId, SQLITE3_TEXT);
    $insertVariant->bindValue(':vid', $vendorId, SQLITE3_TEXT);
    $insertVariant->bindValue(':pname', $productName, SQLITE3_TEXT);
    $insertVariant->bindValue(':shipping', $shippingUsd, SQLITE3_FLOAT);

    foreach ($data['variants'] as $v) {
        $insertVariant->bindValue(':vname', mb_substr($v['name'] ?? '', 0, 255), SQLITE3_TEXT);
        $insertVariant->bindValue(':price', (float)($v['price'] ?? 0), SQLITE3_FLOAT);
        $insertVariant->execute();
    }

    $db->close();

    header('Content-Type: application/json');
    echo json_encode(['status' => 'ok', 'user' => $userName]);

} catch (Exception $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => $e->getMessage()]);
}
