// A React component that displays system configuration settings in a collapsible panel
// with the ability to edit and save configuration values. All configurations are
// displayed under a single, expandable category.

import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { SectionContainer, InputContainer } from "./BatchProcessorStyles";
import SecureButton from "./SecureButton";
import { useAuthProtection } from "./withAuthProtection";

interface ConfigItem {
  ConfigKey: string;
  ConfigValue: string;
  Description: string;
  LastUpdated: string;
  ConfigId: number;
  Category?: string; // Optional category field for grouping
}

// Group all configurations under a single category
const groupConfigurations = (
  configs: ConfigItem[]
): Record<string, ConfigItem[]> => {
  // Create a single category for all configuration items
  const SINGLE_CATEGORY = "System Settings";

  return {
    [SINGLE_CATEGORY]: [...configs],
  };
};

const ConfigPanel: React.FC = () => {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});
  const { disabled } = useAuthProtection();

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async (): Promise<void> => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/config`
      );

      // Extract the config array from the response
      const configData = response.data.success
        ? response.data.config
        : response.data;

      // Sort the configurations by ConfigId
      const sortedConfigs = configData.sort(
        (a: ConfigItem, b: ConfigItem) => a.ConfigId - b.ConfigId
      );

      setConfigs(sortedConfigs);
    } catch (error) {
      console.error("Error fetching configuration:", error);
      toast.error("Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (index: number, value: string): void => {
    const newConfigs = [...configs];
    newConfigs[index].ConfigValue = value;
    setConfigs(newConfigs);
  };

  const saveConfig = async (config: ConfigItem): Promise<void> => {
    try {
      await axios.put(
        `${process.env.REACT_APP_API_URL}/config/${config.ConfigKey}`,
        {
          value: config.ConfigValue,
        }
      );
      toast.success(`${config.ConfigKey} updated successfully`);
    } catch (error) {
      console.error("Error updating config:", error);
      toast.error(`Failed to update ${config.ConfigKey}`);
    }
  };

  const toggleSection = (section: string): void => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Group configurations under a single category
  const groupedConfigs = groupConfigurations(configs);

  return (
    <SectionContainer
      style={{
        width: "90%",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      <h2>System Configuration</h2>
      {loading ? (
        <p>Loading configurations...</p>
      ) : (
        <>
          {Object.entries(groupedConfigs).map(([category, categoryConfigs]) => (
            <div
              key={category}
              className="config-section"
              style={{
                marginBottom: "20px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                overflow: "hidden",
              }}
            >
              <div
                className="section-header"
                onClick={() => toggleSection(category)}
                style={{
                  padding: "10px 15px",
                  backgroundColor: "#f5f5f5",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h3 style={{ margin: 0 }}>{category}</h3>
                <span>{expandedSections[category] ? "▼" : "►"}</span>
              </div>

              {expandedSections[category] && (
                <div className="section-content" style={{ padding: "10px" }}>
                  {categoryConfigs.map((config, index) => {
                    // Find the overall index in the original array
                    const originalIndex = configs.findIndex(
                      (c) => c.ConfigId === config.ConfigId
                    );

                    return (
                      <InputContainer
                        key={config.ConfigKey}
                        style={{ overflow: "hidden" }}
                      >
                        <div>
                          <strong>
                            {config.Description || config.ConfigKey}:
                          </strong>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            marginTop: "5px",
                            marginBottom: "5px",
                            width: "70%",
                            maxWidth: "100%",
                          }}
                        >
                          <input
                            type="text"
                            value={config.ConfigValue}
                            onChange={(e) =>
                              handleConfigChange(originalIndex, e.target.value)
                            }
                            disabled={disabled}
                            style={{
                              flexGrow: 1,
                              minWidth: 0,
                              maxWidth: "calc(100% - 80px)",
                            }}
                          />
                          <SecureButton
                            onClick={() => saveConfig(config)}
                            disabled={disabled}
                            style={{ flexShrink: 0 }}
                          >
                            Save
                          </SecureButton>
                        </div>
                        <small>
                          Last updated:{" "}
                          {new Date(config.LastUpdated).toLocaleString()}
                        </small>
                      </InputContainer>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </SectionContainer>
  );
};

export default ConfigPanel;
