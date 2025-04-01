function estimateContextConsumption(messages) {
    // Constants for estimation
    const AVG_CHARS_PER_TOKEN = 4; // Average characters per token (approximation)
    const ROLE_TOKEN_OVERHEAD = 5; // Rough token overhead per message for role metadata
    const NEWLINE_TOKEN = 1; // Tokens per newline
  
    let totalTokens = 0;
  
    // Iterate through each message
    for (const message of messages) {
      const { role, content } = message;
  
      // Validate message structure
      if (!role || typeof content !== 'string') {
        throw new Error('Invalid message format: Each message must have a role and content string');
      }
  
      // Estimate tokens for the role (simple string length approximation)
      const roleTokens = Math.ceil(role.length / AVG_CHARS_PER_TOKEN) + ROLE_TOKEN_OVERHEAD;
  
      // Estimate tokens for the content
      let contentTokens = 0;
      if (content.length > 0) {
        // Split content into "words" by whitespace and punctuation
        const roughWords = content
          .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
          .split(/\s+/)
          .filter(word => word.length > 0);
  
        // Base token count from words
        contentTokens = roughWords.length;
  
        // Adjust for character length (some words are longer/shorter than avg)
        const charBasedEstimate = Math.ceil(content.length / AVG_CHARS_PER_TOKEN);
        contentTokens = Math.max(contentTokens, charBasedEstimate); // Take higher estimate
  
        // Add tokens for newlines
        const newlineCount = (content.match(/\n/g) || []).length;
        contentTokens += newlineCount * NEWLINE_TOKEN;
      }
  
      // Add to total
      totalTokens += roleTokens + contentTokens;
    }
  
    return totalTokens;
  }

  module.exports = { estimateContextConsumption };