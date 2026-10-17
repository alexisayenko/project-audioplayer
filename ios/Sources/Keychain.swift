import Foundation
import Security

enum Keychain {
    private static let service = "com.alexisayenko.audioplayer.auth"

    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    static func read(_ key: String) -> Data? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    @discardableResult
    static func write(_ key: String, _ data: Data) -> OSStatus {
        SecItemDelete(query(key) as CFDictionary)
        var q = query(key)
        q[kSecValueData as String] = data
        #if os(iOS)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        #endif
        let status = SecItemAdd(q as CFDictionary, nil)
        if status != errSecSuccess { NSLog("Keychain write for \(key) failed: OSStatus \(status)") }
        return status
    }

    static func delete(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
