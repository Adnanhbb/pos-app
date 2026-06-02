-- Backend Phase 2 schema.
-- Import this into the MySQL/MariaDB database configured in api/config/database.php.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    migration VARCHAR(150) NOT NULL UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS units (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    shortName VARCHAR(50) NULL,
    itemCount INT NOT NULL DEFAULT 0,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_units_is_deleted (is_deleted),
    INDEX idx_units_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_2_units');

CREATE TABLE IF NOT EXISTS taxes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    value DECIMAL(10,2) NOT NULL DEFAULT 0,
    type VARCHAR(50) NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_taxes_is_deleted (is_deleted),
    INDEX idx_taxes_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration note for dev databases that already imported the earlier Phase 3
-- taxes table with a rate column:
-- ALTER TABLE taxes ADD COLUMN value DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER name;
-- UPDATE taxes SET value = rate WHERE value = 0;
-- ALTER TABLE taxes ADD COLUMN type VARCHAR(50) NULL AFTER value;
-- ALTER TABLE taxes DROP COLUMN rate;

CREATE TABLE IF NOT EXISTS discounts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    value DECIMAL(10,2) NOT NULL DEFAULT 0,
    type VARCHAR(50) NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_discounts_is_deleted (is_deleted),
    INDEX idx_discounts_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS brands (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    itemCount INT NOT NULL DEFAULT 0,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_brands_is_deleted (is_deleted),
    INDEX idx_brands_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    itemCount INT NOT NULL DEFAULT 0,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_categories_is_deleted (is_deleted),
    INDEX idx_categories_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_3_low_risk_crud');

CREATE TABLE IF NOT EXISTS customers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    mobile VARCHAR(50) NULL,
    cnic VARCHAR(50) NULL,
    address TEXT NULL,
    invoices INT NOT NULL DEFAULT 0,
    payable DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customers_is_deleted (is_deleted),
    INDEX idx_customers_updated_at (updated_at),
    INDEX idx_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    mobile VARCHAR(50) NULL,
    cnic VARCHAR(50) NULL,
    address TEXT NULL,
    invoices INT NOT NULL DEFAULT 0,
    payable DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_suppliers_is_deleted (is_deleted),
    INDEX idx_suppliers_updated_at (updated_at),
    INDEX idx_suppliers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_4_customers_suppliers');

-- Migration note for dev databases that already imported Phase 4 before cnic:
-- ALTER TABLE customers ADD COLUMN cnic VARCHAR(50) NULL AFTER mobile;
-- ALTER TABLE suppliers ADD COLUMN cnic VARCHAR(50) NULL AFTER mobile;

CREATE TABLE IF NOT EXISTS expenses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    date VARCHAR(50) NOT NULL,
    category VARCHAR(150) NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    description TEXT NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_expenses_is_deleted (is_deleted),
    INDEX idx_expenses_updated_at (updated_at),
    INDEX idx_expenses_date (date),
    INDEX idx_expenses_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration note for dev databases that already imported Phase 5 with title:
-- ALTER TABLE expenses MODIFY COLUMN date VARCHAR(50) NOT NULL;
-- ALTER TABLE expenses MODIFY COLUMN category VARCHAR(150) NOT NULL;
-- ALTER TABLE expenses DROP COLUMN title;

CREATE TABLE IF NOT EXISTS expense_categories (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    settings_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_5_expenses_settings');

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    mobile VARCHAR(50) NULL,
    role VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_is_deleted (is_deleted),
    INDEX idx_users_username (username),
    INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_6_users');

-- Migration note for dev databases that already imported Phase 6 before mobile:
-- ALTER TABLE users ADD COLUMN mobile VARCHAR(50) NULL AFTER name;

CREATE TABLE IF NOT EXISTS held (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    customerName VARCHAR(180) NULL,
    supplierName VARCHAR(180) NULL,
    transactionType VARCHAR(80) NULL,
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    held_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    INDEX idx_held_is_deleted (is_deleted),
    INDEX idx_held_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS held_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    held_id BIGINT UNSIGNED NOT NULL,
    item_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_held_items_held_id (held_id),
    CONSTRAINT fk_held_items_held
        FOREIGN KEY (held_id) REFERENCES held(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_7_held');

-- Migration note for dev databases that already imported Phase 7 before held_json:
-- ALTER TABLE held ADD COLUMN held_json LONGTEXT NULL AFTER total;

CREATE TABLE IF NOT EXISTS items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    barcode VARCHAR(100) NULL,
    description TEXT NULL,
    purchasePrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    retailPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    discountPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    wholesalePrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    availableStock DECIMAL(12,2) NOT NULL DEFAULT 0,
    category VARCHAR(150) NULL,
    brand VARCHAR(150) NULL,
    minunit VARCHAR(80) NULL,
    maxunit VARCHAR(80) NULL,
    ConvQty DECIMAL(12,2) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_items_is_deleted (is_deleted),
    INDEX idx_items_updated_at (updated_at),
    INDEX idx_items_barcode (barcode),
    INDEX idx_items_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_8_items_safe_profile');



CREATE TABLE IF NOT EXISTS api_auth_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    actor_type VARCHAR(50) NOT NULL,
    actor_id VARCHAR(150) NOT NULL,
    role VARCHAR(80) NOT NULL,
    label VARCHAR(180) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    expires_at DATETIME NULL,
    last_used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_api_auth_tokens_actor (actor_type, actor_id),
    INDEX idx_api_auth_tokens_role (role),
    INDEX idx_api_auth_tokens_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('auth_session_foundation');

CREATE TABLE IF NOT EXISTS transaction_idempotency (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_transaction_id VARCHAR(150) NOT NULL UNIQUE,
    transaction_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    request_hash CHAR(64) NOT NULL,
    response_json LONGTEXT NULL,
    error_message TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_transaction_idempotency_status (status),
    INDEX idx_transaction_idempotency_type (transaction_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_transaction_id VARCHAR(150) NOT NULL UNIQUE,
    transaction_type VARCHAR(50) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'stored',
    replay_status VARCHAR(30) NOT NULL DEFAULT 'stored',
    replay_attempts INT NOT NULL DEFAULT 0,
    replay_started_at DATETIME NULL,
    replay_finished_at DATETIME NULL,
    replay_error TEXT NULL,
    locked_at DATETIME NULL,
    locked_by VARCHAR(150) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sync_transactions_status (status),
    INDEX idx_sync_transactions_replay_status (replay_status),
    INDEX idx_sync_transactions_type (transaction_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transaction_replay_audit (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sync_transaction_id BIGINT UNSIGNED NULL,
    client_transaction_id VARCHAR(150) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    status_before VARCHAR(30) NULL,
    status_after VARCHAR(30) NULL,
    message VARCHAR(255) NULL,
    actor_type VARCHAR(50) NULL,
    actor_id VARCHAR(150) NULL,
    actor_role VARCHAR(80) NULL,
    session_id VARCHAR(150) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_transaction_replay_audit_sync_transaction_id (sync_transaction_id),
    INDEX idx_transaction_replay_audit_client_transaction_id (client_transaction_id),
    INDEX idx_transaction_replay_audit_event_type (event_type),
    INDEX idx_transaction_replay_audit_actor (actor_type, actor_id),
    INDEX idx_transaction_replay_audit_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration note for dev databases created before replay audit attribution:
-- ALTER TABLE transaction_replay_audit ADD COLUMN actor_type VARCHAR(50) NULL AFTER message;
-- ALTER TABLE transaction_replay_audit ADD COLUMN actor_id VARCHAR(150) NULL AFTER actor_type;
-- ALTER TABLE transaction_replay_audit ADD COLUMN actor_role VARCHAR(80) NULL AFTER actor_id;
-- ALTER TABLE transaction_replay_audit ADD COLUMN session_id VARCHAR(150) NULL AFTER actor_role;
-- CREATE INDEX idx_transaction_replay_audit_actor ON transaction_replay_audit (actor_type, actor_id);
-- CREATE INDEX idx_transaction_replay_audit_session_id ON transaction_replay_audit (session_id);

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_9_transaction_storage_skeleton');

CREATE TABLE IF NOT EXISTS sales (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sync_transaction_id BIGINT UNSIGNED NULL UNIQUE,
    client_transaction_id VARCHAR(150) NULL UNIQUE,
    invoiceNo VARCHAR(120) NOT NULL,
    date VARCHAR(50) NULL,
    transactionType VARCHAR(80) NOT NULL,
    customerId BIGINT UNSIGNED NULL,
    supplierId BIGINT UNSIGNED NULL,
    customerName VARCHAR(180) NULL,
    supplierName VARCHAR(180) NULL,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax DECIMAL(12,2) NOT NULL DEFAULT 0,
    dues DECIMAL(12,2) NOT NULL DEFAULT 0,
    grandTotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    arrears DECIMAL(12,2) NOT NULL DEFAULT 0,
    profit DECIMAL(12,2) NOT NULL DEFAULT 0,
    isPostponed TINYINT(1) NOT NULL DEFAULT 0,
    sale_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sales_invoiceNo (invoiceNo),
    INDEX idx_sales_transactionType (transactionType),
    INDEX idx_sales_customerId (customerId),
    INDEX idx_sales_supplierId (supplierId),
    INDEX idx_sales_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sale_id BIGINT UNSIGNED NOT NULL,
    originalItemId BIGINT UNSIGNED NOT NULL,
    name VARCHAR(180) NOT NULL,
    qty DECIMAL(12,2) NOT NULL DEFAULT 0,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    priceCategory VARCHAR(50) NULL,
    discountType VARCHAR(20) NULL,
    discountValue DECIMAL(12,2) NOT NULL DEFAULT 0,
    taxType VARCHAR(20) NULL,
    taxValue DECIMAL(12,2) NOT NULL DEFAULT 0,
    item_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sale_items_sale_id (sale_id),
    INDEX idx_sale_items_originalItemId (originalItemId),
    CONSTRAINT fk_sale_items_sale
        FOREIGN KEY (sale_id) REFERENCES sales(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_10_sales_persistence_replay');

CREATE TABLE IF NOT EXISTS customer_payments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customerId BIGINT UNSIGNED NOT NULL,
    customerName VARCHAR(180) NULL,
    invoiceNo VARCHAR(120) NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    paymentDate VARCHAR(50) NULL,
    remarks TEXT NULL,
    payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
    balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
    sync_transaction_id BIGINT UNSIGNED NULL UNIQUE,
    client_transaction_id VARCHAR(150) NULL,
    sale_id BIGINT UNSIGNED NULL,
    source VARCHAR(80) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_customer_payments_customerId (customerId),
    INDEX idx_customer_payments_invoiceNo (invoiceNo),
    INDEX idx_customer_payments_client_transaction_id (client_transaction_id),
    INDEX idx_customer_payments_sale_id (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_payments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplierId BIGINT UNSIGNED NOT NULL,
    supplierName VARCHAR(180) NULL,
    invoiceNo VARCHAR(120) NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    paymentDate VARCHAR(50) NULL,
    remarks TEXT NULL,
    payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
    balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
    sync_transaction_id BIGINT UNSIGNED NULL UNIQUE,
    client_transaction_id VARCHAR(150) NULL,
    sale_id BIGINT UNSIGNED NULL,
    source VARCHAR(80) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_supplier_payments_supplierId (supplierId),
    INDEX idx_supplier_payments_invoiceNo (invoiceNo),
    INDEX idx_supplier_payments_client_transaction_id (client_transaction_id),
    INDEX idx_supplier_payments_sale_id (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_10_payment_ledgers_replay');

CREATE TABLE IF NOT EXISTS item_batches (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    itemId BIGINT UNSIGNED NOT NULL,
    purchaseDate VARCHAR(50) NOT NULL,
    qtyPurchased DECIMAL(12,2) NOT NULL DEFAULT 0,
    qtySold DECIMAL(12,2) NOT NULL DEFAULT 0,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    costPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
    sourceSaleId BIGINT UNSIGNED NULL,
    invoiceNo VARCHAR(120) NULL,
    sync_transaction_id BIGINT UNSIGNED NULL,
    client_transaction_id VARCHAR(150) NULL,
    batch_json LONGTEXT NULL,
    isDeleted TINYINT(1) NOT NULL DEFAULT 0,
    deletedAt DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_item_batches_itemId (itemId),
    INDEX idx_item_batches_invoiceNo (invoiceNo),
    INDEX idx_item_batches_balance (balance),
    INDEX idx_item_batches_sync_transaction_id (sync_transaction_id),
    INDEX idx_item_batches_client_transaction_id (client_transaction_id),
    INDEX idx_item_batches_isDeleted (isDeleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_11_item_batches_replay');

-- Migration note for dev databases that already have a frontend-shaped batch table:
-- ALTER TABLE item_batches ADD COLUMN sync_transaction_id BIGINT UNSIGNED NULL;
-- ALTER TABLE item_batches ADD COLUMN client_transaction_id VARCHAR(150) NULL;
-- ALTER TABLE item_batches ADD COLUMN batch_json LONGTEXT NULL;
-- CREATE INDEX idx_item_batches_sync_transaction_id ON item_batches (sync_transaction_id);

CREATE TABLE IF NOT EXISTS cylinders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    itemId BIGINT UNSIGNED NOT NULL UNIQUE,
    title VARCHAR(180) NOT NULL,
    qtyInStock DECIMAL(12,2) NOT NULL DEFAULT 0,
    filledCylinders DECIMAL(12,2) NOT NULL DEFAULT 0,
    emptyCylinders DECIMAL(12,2) NOT NULL DEFAULT 0,
    withCustomers DECIMAL(12,2) NOT NULL DEFAULT 0,
    convQty DECIMAL(12,2) NOT NULL DEFAULT 1,
    isDeleted TINYINT(1) NOT NULL DEFAULT 0,
    deletedAt DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cylinders_itemId (itemId),
    INDEX idx_cylinders_title (title),
    INDEX idx_cylinders_isDeleted (isDeleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cylinder_customers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cylinderId BIGINT UNSIGNED NOT NULL,
    cylinderType VARCHAR(180) NOT NULL,
    customerName VARCHAR(180) NOT NULL,
    qtyHeld DECIMAL(12,2) NOT NULL DEFAULT 0,
    isDeleted TINYINT(1) NOT NULL DEFAULT 0,
    deletedAt DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cylinder_customers_cylinderId (cylinderId),
    INDEX idx_cylinder_customers_customerName (customerName),
    INDEX idx_cylinder_customers_isDeleted (isDeleted),
    UNIQUE KEY uniq_cylinder_customer_active (cylinderId, customerName, isDeleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration)
VALUES ('phase_12_cylinder_replay');

-- Migration note for dev databases that already have frontend-shaped cylinder stores:
-- CREATE TABLE IF NOT EXISTS cylinders (...same columns as above...);
-- CREATE TABLE IF NOT EXISTS cylinder_customers (...same columns as above...);
