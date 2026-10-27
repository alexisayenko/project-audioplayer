import SwiftUI

/// A setting kept in UserDefaults, read once when the view appears. Unlike `@AppStorage` it does not wake the view on every
/// write to any key: the playback checkpoint writes every 5 s, which re-rendered the always-alive Statistics chart each time.
@propertyWrapper
struct StoredValue<Value>: DynamicProperty {
    @State private var value: Value
    private let key: String

    init(wrappedValue: Value, _ key: String) {
        self.key = key
        _value = State(initialValue: UserDefaults.standard.object(forKey: key) as? Value ?? wrappedValue)
    }

    var wrappedValue: Value {
        get { value }
        nonmutating set {
            value = newValue
            UserDefaults.standard.set(newValue, forKey: key)
        }
    }

    var projectedValue: Binding<Value> {
        Binding(get: { value }, set: { wrappedValue = $0 })
    }
}
