package loop

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsOpenAIModel(t *testing.T) {
	openai := []string{
		"gpt-4o",
		"gpt-4o-mini",
		"gpt-4-turbo",
		"gpt-4",
		"gpt-3.5-turbo",
		"o1",
		"o1-mini",
		"o1-preview",
		"o3",
		"o3-mini",
		"o4-mini",
	}

	for _, model := range openai {
		assert.True(t, isOpenAIModel(model), "expected %q to be OpenAI model", model)
	}
}

func TestIsOpenAIModel_NotOpenAI(t *testing.T) {
	notOpenAI := []string{
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-haiku-4-5-20251001",
		"llama-3",
		"mistral-large",
		"gemini-pro",
		"custom-model",
		"",
	}

	for _, model := range notOpenAI {
		assert.False(t, isOpenAIModel(model), "expected %q to NOT be OpenAI model", model)
	}
}

func TestCreateProvider_Anthropic(t *testing.T) {
	// Anthropic provider requires either APIKey or OAuthToken
	prov, err := createProvider("claude-sonnet-4-6", "sk-ant-test", "")
	assert.NoError(t, err)
	assert.NotNil(t, prov)
	assert.Equal(t, "anthropic", prov.Name())
}

func TestCreateProvider_AnthropicOAuth(t *testing.T) {
	prov, err := createProvider("claude-opus-4-6", "", "oauth-token")
	assert.NoError(t, err)
	assert.NotNil(t, prov)
	assert.Equal(t, "anthropic", prov.Name())
}

func TestCreateProvider_OpenAI(t *testing.T) {
	prov, err := createProvider("gpt-4o", "sk-openai-test", "")
	assert.NoError(t, err)
	assert.NotNil(t, prov)
	assert.Equal(t, "openai", prov.Name())
}

func TestCreateProvider_OpenAI_O3(t *testing.T) {
	prov, err := createProvider("o3-mini", "sk-openai-test", "")
	assert.NoError(t, err)
	assert.NotNil(t, prov)
	assert.Equal(t, "openai", prov.Name())
}

func TestCreateProvider_OpenAI_NoKey(t *testing.T) {
	_, err := createProvider("gpt-4o", "", "")
	assert.Error(t, err) // OpenAI requires API key
}

func TestCreateProvider_Anthropic_NoCredentials(t *testing.T) {
	_, err := createProvider("claude-sonnet-4-6", "", "")
	assert.Error(t, err) // Anthropic requires APIKey or OAuthToken
}

func TestCreateProvider_DefaultToAnthropic(t *testing.T) {
	// Unknown model defaults to Anthropic
	prov, err := createProvider("unknown-model", "sk-test", "")
	assert.NoError(t, err)
	assert.Equal(t, "anthropic", prov.Name())
}
