cmake_minimum_required(VERSION 3.22.1)
project(concordargon2 C)

# The same vendored reference sources as the iOS pod; see ../../../../Vendor/README.md.
set(ARGON2 ${CMAKE_CURRENT_SOURCE_DIR}/../../../../Vendor/argon2)
add_library(concordargon2 SHARED
    argon2_jni.c
    ${ARGON2}/src/argon2.c
    ${ARGON2}/src/core.c
    ${ARGON2}/src/ref.c
    ${ARGON2}/src/encoding.c
    ${ARGON2}/src/blake2/blake2b.c)
target_include_directories(concordargon2 PRIVATE ${ARGON2}/include ${ARGON2}/src)
# Lanes are still 4 (the derived key depends on them); they are computed on one thread.
target_compile_definitions(concordargon2 PRIVATE ARGON2_NO_THREADS=1)
target_link_options(concordargon2 PRIVATE "-Wl,-z,max-page-size=16384")
