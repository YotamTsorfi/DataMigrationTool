/**
 * A React component that displays and manages system configuration settings in a collapsible panel.
 * Supports creating, reading, updating, and deleting configuration values with improved layout and tooltips.
 */
import React, { useState, useEffect } from "react";
import axios, { AxiosError } from "axios";
import { toast } from "react-toastify";
import { SectionContainer } from "./BatchProcessorStyles";
import SecureButton from "./SecureButton";
import { useAuthProtection } from "./withAuthProtection";
import Modal from "./Modal";
import styled from "styled-components";

const PageContainer = styled.div`
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
`;
interface ConfigItem {
  ConfigId: number;
  ConfigKey: string;
  ConfigValue: string;
  Description: string;
  LastUpdated: string;
  IsVisible: boolean;
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newConfig, setNewConfig] = useState<{
    key: string;
    value: string;
    description: string;
    isVisible: boolean;
  }>({
    key: "",
    value: "",
    description: "",
    isVisible: true,
  });

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
          description: config.Description,
          isVisible: config.IsVisible,
        }
      );
      console.log("Save successful, triggering toast");
      toast.success(`${config.ConfigKey} updated successfully`);
    } catch (error) {
      console.error("Error updating config:", error);
      const axiosError = error as AxiosError<{ error: string }>;
      toast.error(
        `Failed to update ${config.ConfigKey}: ${
          axiosError.response?.data?.error || "Unknown error"
        }`
      );
    }
  };

  const deleteConfig = async (config: ConfigItem): Promise<void> => {
    if (
      !window.confirm(`Are you sure you want to delete "${config.ConfigKey}"?`)
    ) {
      return;
    }

    try {
      await axios.delete(
        `${process.env.REACT_APP_API_URL}/config/${config.ConfigKey}`
      );
      toast.success(`${config.ConfigKey} deleted successfully`);
      fetchConfigs(); // Refresh the list
    } catch (error) {
      console.error("Error deleting config:", error);
      const axiosError = error as AxiosError<{ error: string }>;
      toast.error(
        `Failed to delete ${config.ConfigKey}: ${
          axiosError.response?.data?.error || "Unknown error"
        }`
      );
    }
  };

  const toggleVisibility = async (config: ConfigItem): Promise<void> => {
    try {
      await axios.put(
        `${process.env.REACT_APP_API_URL}/config/${config.ConfigKey}`,
        {
          value: config.ConfigValue,
          isVisible: !config.IsVisible,
        }
      );
      toast.success(`${config.ConfigKey} visibility updated`);
      fetchConfigs(); // Refresh the list
    } catch (error) {
      console.error("Error updating visibility:", error);
      const axiosError = error as AxiosError<{ error: string }>;
      toast.error(
        `Failed to update ${config.ConfigKey} visibility: ${
          axiosError.response?.data?.error || "Unknown error"
        }`
      );
    }
  };

  const createConfig = async (): Promise<void> => {
    try {
      if (!newConfig.key.trim() || !newConfig.value.trim()) {
        toast.error("Key and Value are required");
        return;
      }

      await axios.post(`${process.env.REACT_APP_API_URL}/config`, {
        key: newConfig.key.trim(),
        value: newConfig.value.trim(),
        description: newConfig.description.trim(),
        isVisible: newConfig.isVisible,
      });

      toast.success(`${newConfig.key} created successfully`);
      setShowCreateModal(false);
      // Reset form
      setNewConfig({
        key: "",
        value: "",
        description: "",
        isVisible: true,
      });
      fetchConfigs(); // Refresh the list
    } catch (error) {
      console.error("Error creating config:", error);
      // Type guard to handle Axios errors properly
      const axiosError = error as AxiosError<{ error: string }>;
      toast.error(
        `Failed to create configuration: ${
          axiosError.response?.data?.error || "Unknown error"
        }`
      );
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

  // Create Modal component
  const renderCreateModal = () => {
    return (
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Add New Configuration"
      >
        <div className="modal-content" style={{ padding: "20px" }}>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Key *
            </label>
            <input
              type="text"
              value={newConfig.key}
              onChange={(e) =>
                setNewConfig({ ...newConfig, key: e.target.value })
              }
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Value *
            </label>
            <input
              type="text"
              value={newConfig.value}
              onChange={(e) =>
                setNewConfig({ ...newConfig, value: e.target.value })
              }
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Description
            </label>
            <textarea
              value={newConfig.description}
              onChange={(e) =>
                setNewConfig({ ...newConfig, description: e.target.value })
              }
              style={{ width: "100%", padding: "8px", minHeight: "80px" }}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={newConfig.isVisible}
                onChange={(e) =>
                  setNewConfig({ ...newConfig, isVisible: e.target.checked })
                }
                style={{ marginRight: "8px" }}
              />
              Visible in UI
            </label>
          </div>

          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}
          >
            <SecureButton
              onClick={() => setShowCreateModal(false)}
              style={{ background: "#6c757d" }}
            >
              Cancel
            </SecureButton>
            <SecureButton onClick={createConfig}>Create</SecureButton>
          </div>
        </div>
      </Modal>
    );
  };

  return (
    <PageContainer>
      <SectionContainer
        style={{
          width: "98%", // Increased from 90% to 98%
          maxWidth: "1500px", // Increased from 1200px to 1500px
          margin: "0 auto",
          overflow: "hidden", // Prevent horizontal scrolling
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2>System Configuration</h2>
          <SecureButton
            onClick={() => setShowCreateModal(true)}
            disabled={disabled}
            style={{ background: "#28a745" }}
          >
            Add New Config
          </SecureButton>
        </div>

        {loading ? (
          <p>Loading configurations...</p>
        ) : (
          <>
            {Object.entries(groupedConfigs).map(
              ([category, categoryConfigs]) => (
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
                    <div
                      className="section-content"
                      style={{ padding: "10px" }}
                    >
                      {categoryConfigs.length === 0 ? (
                        <p>No configurations found.</p>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          {" "}
                          {/* Add horizontal scroll for narrow screens */}
                          <table
                            style={{
                              width: "100%",
                              borderCollapse: "collapse",
                              tableLayout: "fixed", // Better column width control
                            }}
                          >
                            <colgroup>
                              <col
                                style={{ width: "32%", minWidth: "180px" }}
                              />
                              {/* Key */}
                              <col style={{ width: "40%" }} />
                              {/* Value */}
                              <col style={{ width: "45%" }} />
                              {/* Description */}
                              <col
                                style={{ width: "27%", minWidth: "180px" }}
                              />
                              {/* Last Updated */}
                              <col
                                style={{ width: "22%", minWidth: "150px" }}
                              />
                              {/* Actions */}
                            </colgroup>
                            <thead>
                              <tr>
                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px",
                                    borderBottom: "1px solid #ddd",
                                  }}
                                >
                                  Key
                                </th>
                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px",
                                    borderBottom: "1px solid #ddd",
                                  }}
                                >
                                  Value
                                </th>
                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px",
                                    borderBottom: "1px solid #ddd",
                                  }}
                                >
                                  Description
                                </th>
                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px",
                                    borderBottom: "1px solid #ddd",
                                  }}
                                >
                                  Last Updated
                                </th>
                                <th
                                  style={{
                                    textAlign: "center",
                                    padding: "8px",
                                    borderBottom: "1px solid #ddd",
                                  }}
                                >
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {categoryConfigs.map((config, index) => {
                                // Find the overall index in the original array
                                const originalIndex = configs.findIndex(
                                  (c) => c.ConfigId === config.ConfigId
                                );

                                return (
                                  <tr
                                    key={config.ConfigKey}
                                    style={{
                                      backgroundColor: config.IsVisible
                                        ? "white"
                                        : "#f8f9fa",
                                    }}
                                  >
                                    <td
                                      style={{
                                        padding: "8px",
                                        borderBottom: "1px solid #eee",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                      }}
                                      title={config.ConfigKey} // Add tooltip
                                    >
                                      {config.ConfigKey}
                                    </td>
                                    <td
                                      style={{
                                        padding: "8px",
                                        borderBottom: "1px solid #eee",
                                      }}
                                    >
                                      <input
                                        type="text"
                                        value={config.ConfigValue}
                                        onChange={(e) =>
                                          handleConfigChange(
                                            originalIndex,
                                            e.target.value
                                          )
                                        }
                                        disabled={disabled}
                                        style={{ width: "100%" }}
                                        title={config.ConfigValue} // Add tooltip
                                      />
                                    </td>
                                    <td
                                      style={{
                                        padding: "8px",
                                        borderBottom: "1px solid #eee",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap", // For text truncation
                                      }}
                                      title={config.Description || ""} // Add tooltip
                                    >
                                      {config.Description || ""}
                                    </td>
                                    <td
                                      style={{
                                        padding: "8px",
                                        borderBottom: "1px solid #eee",
                                        whiteSpace: "nowrap", // Prevent date from wrapping
                                      }}
                                    >
                                      {new Date(
                                        config.LastUpdated
                                      ).toLocaleString()}
                                    </td>
                                    <td
                                      style={{
                                        padding: "8px",
                                        borderBottom: "1px solid #eee",
                                        textAlign: "center",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "center",
                                          gap: "5px",
                                          flexWrap: "nowrap", // Prevent buttons from wrapping
                                        }}
                                      >
                                        <SecureButton
                                          onClick={() => saveConfig(config)}
                                          disabled={disabled}
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "12px",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          Save
                                        </SecureButton>
                                        <SecureButton
                                          onClick={() =>
                                            toggleVisibility(config)
                                          }
                                          disabled={disabled}
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "12px",
                                            background: config.IsVisible
                                              ? "#6c757d"
                                              : "#28a745",
                                            whiteSpace: "nowrap",
                                          }}
                                          title={
                                            config.IsVisible
                                              ? "Hide from UI"
                                              : "Show in UI"
                                          }
                                        >
                                          {config.IsVisible ? "Hide" : "Show"}
                                        </SecureButton>
                                        <SecureButton
                                          onClick={() => deleteConfig(config)}
                                          disabled={disabled}
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "12px",
                                            background: "#dc3545",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          Delete
                                        </SecureButton>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </>
        )}

        {/* Render the create modal */}
        {renderCreateModal()}
      </SectionContainer>
    </PageContainer>
  );
};

export default ConfigPanel;
