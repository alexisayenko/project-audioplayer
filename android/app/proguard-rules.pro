# kotlinx.serialization keeps its own rules; the models are annotated with @Serializable.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
# Credential Manager's Google ID option is looked up by name.
-keep class com.google.android.libraries.identity.googleid.** { *; }
