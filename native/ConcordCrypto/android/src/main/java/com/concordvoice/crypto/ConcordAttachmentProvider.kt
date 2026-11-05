package com.concordvoice.crypto

import androidx.core.content.FileProvider

/**
 * The share sheet's file provider. Its own class, so another library that registers the stock
 * FileProvider can't collide with it in the merged manifest or swap in its own paths.
 */
class ConcordAttachmentProvider : FileProvider()
